{
  description = "";
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }: let
    pkgs = nixpkgs.legacyPackages.x86_64-linux;
  in {
    packages.x86_64-linux.default = pkgs.buildNpmPackage {
      pname = "pi";
      version = "0.72.0";

      src = pkgs.fetchFromGitHub {
        owner = "badlogic";
        repo = "pi-mono";
        rev = "v0.72.0";
        hash = "sha256-ifA9shJqb7eZVmjXK/TSQfLAT0lvc2fL2d9V7X96heY=";
      };

      npmDepsHash = "sha256-UWzpV+lIcgwejYeeUSp9CvPU+aZU0+ikvkzAkZM2ReE=";

      postPatch = ''
        substituteInPlace packages/ai/package.json \
          --replace 'tsgo -p tsconfig.build.json' \
                    'tsgo --noCheck -p tsconfig.build.json'
      '';

      nativeBuildInputs = [ pkgs.nodejs pkgs.pkg-config pkgs.python3 pkgs.makeWrapper ];
      buildInputs = [ pkgs.pixman pkgs.cairo pkgs.pango pkgs.libjpeg pkgs.giflib ];

      buildPhase = ''
        runHook preBuild
        npm run build
        runHook postBuild
      '';

      installPhase = ''
        runHook preInstall
        mkdir -p $out/bin $out/lib/pi
        # Copy all packages' dist output so workspace symlinks resolve
        for pkg in packages/*/; do
          if [ -d "$pkg/dist" ]; then
            mkdir -p "$out/lib/pi/$pkg"
            cp -r "$pkg/dist" "$out/lib/pi/$pkg/"
            # package.json must sit at the package root (not inside dist/) so relative asset paths resolve correctly
            [ -f "$pkg/package.json" ] && cp "$pkg/package.json" "$out/lib/pi/$pkg/"
          fi
        done
        # Copy root node_modules with symlinks dereferenced so hoisted deps are self-contained
        cp -rL node_modules $out/lib/pi/
        makeWrapper ${pkgs.nodejs}/bin/node $out/bin/pi \
          --add-flags "$out/lib/pi/packages/coding-agent/dist/cli.js"
        runHook postInstall
      '';
    };
  };
}

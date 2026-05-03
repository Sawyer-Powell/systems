{ pkgs }:

pkgs.buildNpmPackage {
  pname = "pi";
  version = "0.72.1";

  src = pkgs.fetchFromGitHub {
    owner = "badlogic";
    repo = "pi-mono";
    rev = "v0.72.1";
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
    for pkg in packages/*/; do
      if [ -d "$pkg/dist" ]; then
        mkdir -p "$out/lib/pi/$pkg"
        cp -r "$pkg/dist" "$out/lib/pi/$pkg/"
        [ -f "$pkg/package.json" ] && cp "$pkg/package.json" "$out/lib/pi/$pkg/"
      fi
    done
    cp -rL node_modules $out/lib/pi/
    makeWrapper ${pkgs.nodejs}/bin/node $out/bin/pi \
      --add-flags "$out/lib/pi/packages/coding-agent/dist/cli.js"
    runHook postInstall
  '';
}

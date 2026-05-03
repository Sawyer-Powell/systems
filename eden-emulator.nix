{ pkgs }:

pkgs.stdenvNoCC.mkDerivation {
  pname = "eden";
  version = "7d0e79335e";

  src = pkgs.fetchurl {
    url = "https://nightly.eden-emu.dev/v1777747568.7d0e79335e/Eden-Linux-7d0e79335e-amd64-clang-pgo.AppImage";
    hash = "sha256-bG0QwCNlvvF3SAV1EusQ8K3oieEFpHc4lBCu5YU9ExQ=";
  };

  dontUnpack = true;

  installPhase = ''
    mkdir -p $out/bin
    cp $src $out/bin/eden
    chmod +x $out/bin/eden
  '';

  # Desktop entry for KDE / Plasma
  postFixup = ''
    mkdir -p $out/share/applications
    cat > $out/share/applications/eden.desktop << EOF
[Desktop Entry]
Name=Eden
Comment=Nintendo Switch emulator
Exec=$out/bin/eden
Icon=applications-games
Terminal=false
Type=Application
Categories=Game;Emulator;
EOF
  '';

  meta = {
    description = "Nintendo Switch emulator";
    homepage = "https://eden-emu.dev";
    license = pkgs.lib.licenses.unfree;
    platforms = [ "x86_64-linux" ];
  };
}

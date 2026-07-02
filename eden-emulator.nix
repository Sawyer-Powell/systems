{ pkgs }:

pkgs.stdenvNoCC.mkDerivation {
  pname = "eden";
  version = "5219b9f3d2";

  src = pkgs.fetchurl {
    url = "https://nightly.eden-emu.dev/v1781122546.5219b9f3d2/Eden-Linux-5219b9f3d2-amd64-clang-pgo.AppImage";
    hash = "sha256-yBiUo8lZBpzqSmQxkXxXAza2elCaSEnKWwaKxf4430E=";
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

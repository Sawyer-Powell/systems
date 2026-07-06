{ pkgs }:

pkgs.stdenvNoCC.mkDerivation {
  pname = "temurin8-legacy-jre";
  version = "8u312-b07";

  src = pkgs.fetchurl {
    url = "https://github.com/adoptium/temurin8-binaries/releases/download/jdk8u312-b07/OpenJDK8U-jre_x64_linux_hotspot_8u312b07.tar.gz";
    hash = "sha256-GP0T53Yh9xIya/z3nD48wIyIDj5Lj2Oh5dphnzBUsGM=";
  };

  sourceRoot = ".";

  nativeBuildInputs = [ pkgs.autoPatchelfHook ];
  buildInputs = with pkgs; [
    alsa-lib
    fontconfig
    freetype
    libx11
    libxext
    libxi
    libxrender
    libxtst
    stdenv.cc.cc.lib
    zlib
  ];

  installPhase = ''
    runHook preInstall
    mkdir -p $out
    cp -a jdk8u312-b07-jre/. $out/
    runHook postInstall
  '';

  meta = {
    description = "Legacy Eclipse Temurin Java 8 runtime for old Minecraft Forge";
    homepage = "https://adoptium.net/temurin/releases/?version=8";
    license = pkgs.lib.licenses.gpl2Only;
    platforms = [ "x86_64-linux" ];
  };
}

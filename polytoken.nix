{ pkgs }:

let
  version = "0.4.0-unstable.4";
  srcs = {
    x86_64-linux = {
      url = "https://dl.polytoken.dev/unstable/${version}/linux-amd64/polytoken.tar.gz";
      hash = "sha256:e59f23dc684a3d78b478751cffd06f871de18ecdd8e21068bfb07d478ae4f092";
    };
    aarch64-linux = {
      url = "https://dl.polytoken.dev/unstable/${version}/linux-arm64/polytoken.tar.gz";
      hash = "sha256:3ba14669ca8084bce7cdb24367612c0e3064b3574e50b0210de15888f50e085f";
    };
  };
  src = srcs.${pkgs.stdenv.hostPlatform.system} or (throw "polytoken: unsupported system ${pkgs.stdenv.hostPlatform.system}");
in
pkgs.stdenv.mkDerivation {
  pname = "polytoken";
  inherit version;

  src = pkgs.fetchurl { inherit (src) url hash; };

  nativeBuildInputs = [ pkgs.autoPatchelfHook ];

  sourceRoot = ".";

  unpackPhase = ''
    tar -xzf $src
  '';

  installPhase = ''
    install -Dm755 polytoken $out/bin/polytoken
  '';
}

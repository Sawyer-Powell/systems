{ pkgs }:

let
  version = "0.8.1";
  srcs = {
    x86_64-linux = {
      url = "https://dl.polytoken.dev/${version}/linux-amd64/polytoken.zip";
      hash = "sha256-sbCcGOHqOhf24j/ZJg28Ld/dQHzStVLyuNhfMPfSDFw=";
    };
    aarch64-linux = {
      url = "https://dl.polytoken.dev/${version}/linux-arm64/polytoken.zip";
      hash = "sha256-You9uswFEVxzwN/Bzz7yWhx5wQ29He/NGwHnkTWVR3A=";
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
    ${pkgs.unzip}/bin/unzip $src
  '';

  installPhase = ''
    install -Dm755 polytoken $out/bin/polytoken
  '';
}

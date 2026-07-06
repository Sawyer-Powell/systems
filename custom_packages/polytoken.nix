{ pkgs }:

let
  version = "0.4.2";
  srcs = {
    x86_64-linux = {
      url = "https://dl.polytoken.dev/${version}/linux-amd64/polytoken.tar.gz";
      hash = "sha256-9iM8DafyMNhT3CtLl80SzDjLoGljrgZoqa4tISgq/LM=";
    };
    aarch64-linux = {
      url = "https://dl.polytoken.dev/${version}/linux-arm64/polytoken.tar.gz";
      hash = "sha256-9iM8DafyMNhT3CtLl80SzDjLoGljrgZoqa4tISgq/LM=";
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

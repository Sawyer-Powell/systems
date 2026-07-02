{ pkgs }:

let
  version = "0.3.3";
  srcs = {
    x86_64-linux = {
      url = "https://dl.polytoken.dev/${version}/linux-amd64/polytoken.tar.gz";
      hash = "sha256:27e7f35084c8b9a91e9d0bd94950b0a774c56f593447045a9826526cb1f305c1";
    };
    aarch64-linux = {
      url = "https://dl.polytoken.dev/${version}/linux-arm64/polytoken.tar.gz";
      hash = "sha256:c795a0717b48c8dfe3b3f7f98a37b4d2fd38287bf733258fdbea46be2aa90c26";
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

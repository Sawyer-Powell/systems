# Decky Loader — Steam Deck plugin loader
# Adapted from Jovian-NixOS (https://github.com/Jovian-Experiments/Jovian-NixOS)
{
  lib,
  fetchFromGitHub,
  nodejs,
  pnpm_9,
  fetchPnpmDeps,
  pnpmConfigHook,
  python3,
  coreutils,
  psmisc,
}:
python3.pkgs.buildPythonPackage rec {
  pname = "decky-loader";
  version = "3.2.3";

  src = fetchFromGitHub {
    owner = "SteamDeckHomebrew";
    repo = "decky-loader";
    rev = "v${version}";
    hash = "sha256-alw1Jb8cFM/TK/fwXAtlmMRXh+dfRvmY4+fdpn9xzPU=";
  };

  # ── Frontend build (TypeScript + React) ──────────────
  pnpmDeps = fetchPnpmDeps {
    inherit pname version src;
    sourceRoot = "${src.name}/frontend";
    pnpm = pnpm_9;
    fetcherVersion = 3;
    hash = "sha256-jSjt1XgYweg2lgWgyHadQ8/fzXnYWbnXvtH4gG6GgDU=";
  };

  pyproject = true;
  pnpmRoot = "frontend";

  nativeBuildInputs = [
    nodejs
    pnpm_9
    pnpmConfigHook
  ];

  preBuild = ''
    cd frontend
    pnpm build
    cd ../backend
  '';

  # ── Backend build (Python + aiohttp) ─────────────────
  build-system = with python3.pkgs; [
    poetry-core
    poetry-dynamic-versioning
  ];

  dependencies = with python3.pkgs; [
    aiohttp
    aiohttp-cors
    aiohttp-jinja2
    certifi
    multidict
    packaging
    setproctitle
    watchdog
  ];

  makeWrapperArgs = [
    "--prefix PATH : ${lib.makeBinPath [ coreutils psmisc ]}"
  ];

  pythonRelaxDeps = [
    "aiohttp-cors"
    "packaging"
    "watchdog"
  ];

  passthru.python = python3;

  meta = with lib; {
    description = "A plugin loader for the Steam Deck";
    homepage = "https://github.com/SteamDeckHomebrew/decky-loader";
    platforms = platforms.linux;
    license = licenses.gpl2Only;
  };
}

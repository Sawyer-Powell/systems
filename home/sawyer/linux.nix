{ config, pkgs, lib, ... }:

let
  bigSurWallpaper = ../../dotfiles/wallpapers/macos-big-sur-dark.jpg;

  monitorBrightness = pkgs.writeShellApplication {
    name = "monitor-brightness";
    runtimeInputs = with pkgs; [ ddcutil gnugrep ];
    text = builtins.readFile ../../dotfiles/scripts/monitor-brightness;
  };

  # Waybar's native slider writes brightness both when its backend refreshes
  # the widget and for every intermediate drag value. It also blocks GTK while
  # logind waits for slow DDC/CI hardware. Keep interaction optimistic, issue a
  # single asynchronous write on release, and ignore stale reads while the
  # monitor catches up.
  waybarBacklightSliderPatch = pkgs.writeText "waybar-backlight-slider-ddcci.patch" ''
    diff --git a/include/modules/backlight_slider.hpp b/include/modules/backlight_slider.hpp
    index 2ba0c36..515c36c 100644
    --- a/include/modules/backlight_slider.hpp
    +++ b/include/modules/backlight_slider.hpp
    @@ -14,11 +14,17 @@ class BacklightSlider : public ASlider {
     
       void update() override;
       void onValueChanged() override;
    +  bool handleButtonPress(GdkEventButton* event);
    +  bool handleButtonRelease(GdkEventButton* event);
     
      private:
       std::chrono::milliseconds interval_;
       std::string preferred_device_;
       util::BacklightBackend backend;
    +  bool updating_ = false;
    +  bool dragging_ = false;
    +  int pending_brightness_ = -1;
    +  std::chrono::steady_clock::time_point settling_until_{};
     };
     
     }  // namespace waybar::modules
    diff --git a/src/modules/backlight_slider.cpp b/src/modules/backlight_slider.cpp
    index 867b397..65033a5 100644
    --- a/src/modules/backlight_slider.cpp
    +++ b/src/modules/backlight_slider.cpp
    @@ -1,5 +1,7 @@
     #include "modules/backlight_slider.hpp"
     
    +#include <cmath>
    +
     #include "ASlider.hpp"
     
     namespace waybar::modules {
    @@ -9,15 +11,58 @@ BacklightSlider::BacklightSlider(const std::string& id, const Json::Value& config
           interval_(config_["interval"].isUInt() ? config_["interval"].asUInt() : 1000),
           preferred_device_(config["device"].isString() ? config["device"].asString() : ""),
    -      backend(interval_, [this] { this->dp.emit(); }) {}
    +      backend(interval_, [this] { this->dp.emit(); }) {
    +  scale_.add_events(Gdk::BUTTON_PRESS_MASK | Gdk::BUTTON_RELEASE_MASK);
    +  scale_.signal_button_press_event().connect(
    +      sigc::mem_fun(*this, &BacklightSlider::handleButtonPress), false);
    +  scale_.signal_button_release_event().connect(
    +      sigc::mem_fun(*this, &BacklightSlider::handleButtonRelease), false);
    +}
     
     void BacklightSlider::update() {
    +  if (dragging_) {
    +    return;
    +  }
    +
       uint16_t brightness = backend.get_scaled_brightness(preferred_device_);
    +  if (pending_brightness_ >= 0) {
    +    if (brightness == pending_brightness_ ||
    +        std::chrono::steady_clock::now() >= settling_until_) {
    +      pending_brightness_ = -1;
    +    } else {
    +      return;
    +    }
    +  }
    +
    +  updating_ = true;
       scale_.set_value(brightness);
    +  updating_ = false;
     }
     
     void BacklightSlider::onValueChanged() {
    +  if (updating_ || dragging_) {
    +    return;
    +  }
    +
       auto brightness = scale_.get_value();
       backend.set_scaled_brightness(preferred_device_, brightness);
     }
     
    +bool BacklightSlider::handleButtonPress(GdkEventButton* event) {
    +  if (event->button == 1) {
    +    dragging_ = true;
    +    pending_brightness_ = -1;
    +  }
    +  return false;
    +}
    +
    +bool BacklightSlider::handleButtonRelease(GdkEventButton* event) {
    +  if (event->button == 1 && dragging_) {
    +    dragging_ = false;
    +    pending_brightness_ = static_cast<int>(std::round(scale_.get_value()));
    +    settling_until_ = std::chrono::steady_clock::now() + std::chrono::seconds(3);
    +    backend.set_scaled_brightness(preferred_device_, pending_brightness_);
    +  }
    +  return false;
    +}
    +
     }  // namespace waybar::modules
    diff --git a/include/modules/pulseaudio_slider.hpp b/include/modules/pulseaudio_slider.hpp
    index 9fdb05b..e9a4f8a 100644
    --- a/include/modules/pulseaudio_slider.hpp
    +++ b/include/modules/pulseaudio_slider.hpp
    @@ -21,6 +21,7 @@ class PulseaudioSlider : public ASlider {
      private:
       std::shared_ptr<util::AudioBackend> backend = nullptr;
       PulseaudioSliderTarget target = PulseaudioSliderTarget::Sink;
    +  bool updating_ = false;
     };
     
     }  // namespace waybar::modules
    diff --git a/src/modules/pulseaudio_slider.cpp b/src/modules/pulseaudio_slider.cpp
    index 6d440c0..b6d05b8 100644
    --- a/src/modules/pulseaudio_slider.cpp
    +++ b/src/modules/pulseaudio_slider.cpp
    @@ -23,6 +23,7 @@ PulseaudioSlider::PulseaudioSlider(const std::string& id, const Json::Value& conf
     }
     
     void PulseaudioSlider::update() {
    +  updating_ = true;
       switch (target) {
         case PulseaudioSliderTarget::Sink:
           if (backend->getSinkMuted()) {
    @@ -42,9 +43,14 @@ void PulseaudioSlider::update() {
           }
           break;
       }
    +  updating_ = false;
     }
     
     void PulseaudioSlider::onValueChanged() {
    +  if (updating_) {
    +    return;
    +  }
    +
       bool is_mute = false;
     
       switch (target) {
    diff --git a/src/util/backlight_backend.cpp b/src/util/backlight_backend.cpp
    index 42dc9cb..918596e 100644
    --- a/src/util/backlight_backend.cpp
    +++ b/src/util/backlight_backend.cpp
    @@ -247,7 +247,7 @@ void BacklightBackend::set_brightness_internal(const std::string& device_name, in
       auto call_args = Glib::VariantContainerBase(
           g_variant_new("(ssu)", "backlight", device_name.c_str(), brightness));
     
    -  login_proxy_->call_sync("SetBrightness", call_args);
    +  login_proxy_->call("SetBrightness", call_args);
     }
     
     int BacklightBackend::get_scaled_brightness(const std::string& preferred_device) {
  '';

  patchedWaybar = pkgs.waybar.overrideAttrs (old: {
    patches = (old.patches or [ ]) ++ [ waybarBacklightSliderPatch ];
  });

  waybarPublicIp = pkgs.writeShellApplication {
    name = "waybar-public-ip";
    runtimeInputs = with pkgs; [ curl jq coreutils ];
    text = ''
      cache_dir="''${XDG_CACHE_HOME:-$HOME/.cache}/waybar"
      cache_file="$cache_dir/public-ip.json"
      mkdir -p "$cache_dir"

      tmp_file=$(mktemp "$cache_dir/public-ip.XXXXXX")
      trap 'rm -f "$tmp_file"' EXIT

      if curl --fail --silent --show-error --location \
        --connect-timeout 3 --max-time 6 \
        --header 'Accept: application/json' \
        'https://ipconfig.io/json' > "$tmp_file" \
        && jq -e '.ip | type == "string" and length > 0' "$tmp_file" >/dev/null; then
        jq -c '{
          text: ("󰩟 " + .ip + "  " + ([.city, .region_name, .country_iso] | map(select(type == "string" and length > 0)) | join(", "))),
          tooltip: ("Public internet exit (approximate)\nIP: " + .ip + "\nLocation: " + ([.city, .region_name, .country_iso] | map(select(type == "string" and length > 0)) | join(", ")) + "\nNetwork: " + (.asn_org // "Unknown")),
          class: "online"
        }' "$tmp_file" | tee "$cache_file"
      elif [ -s "$cache_file" ]; then
        jq -c '.class = "stale" | .tooltip += "\nUpdate failed; showing last known result."' "$cache_file"
      else
        jq -cn '{text: "󰩟 Public IP unavailable", tooltip: "Could not determine the public internet exit.", class: "error"}'
      fi
    '';
  };

  waybarShorelineWind = pkgs.writeShellApplication {
    name = "waybar-shoreline-wind";
    runtimeInputs = with pkgs; [ curl jq coreutils ];
    text = ''
      cache_dir="''${XDG_CACHE_HOME:-$HOME/.cache}/waybar"
      cache_file="$cache_dir/shoreline-wind.json"
      mkdir -p "$cache_dir"

      tmp_file=$(mktemp "$cache_dir/shoreline-wind.XXXXXX")
      trap 'rm -f "$tmp_file"' EXIT

      url='https://api.open-meteo.com/v1/forecast?latitude=37.432785&longitude=-122.091743&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=kn&timezone=America%2FLos_Angeles'

      if curl --fail --silent --show-error --location \
        --connect-timeout 3 --max-time 6 "$url" > "$tmp_file" \
        && jq -e '.current.wind_speed_10m | type == "number"' "$tmp_file" >/dev/null; then
        jq -c '
          def compass:
            (["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]
             [(((. + 11.25) / 22.5) | floor) % 16]);
          .current as $c
          | ($c.wind_direction_10m | compass) as $direction
          | {
              text: ("󰖝 Shoreline " + ($c.wind_speed_10m | tostring) + " kn " + $direction),
              tooltip: ("Shoreline Lake wind\nWind: " + ($c.wind_speed_10m | tostring) + " kn from " + $direction + " (" + ($c.wind_direction_10m | tostring) + "°)\nGusts: " + ($c.wind_gusts_10m | tostring) + " kn\nModel time: " + $c.time),
              class: "online"
            }
        ' "$tmp_file" | tee "$cache_file"
      elif [ -s "$cache_file" ]; then
        jq -c '.class = "stale" | .tooltip += "\nUpdate failed; showing last known result."' "$cache_file"
      else
        jq -cn '{text: "󰖝 Shoreline wind unavailable", tooltip: "Could not retrieve Shoreline Lake wind.", class: "error"}'
      fi
    '';
  };

  niriWindowSwitcher = pkgs.writeShellApplication {
    name = "niri-window-switcher";
    runtimeInputs = with pkgs; [ niri jq fuzzel ];
    text = builtins.readFile ../../dotfiles/scripts/niri-window-switcher;
  };

  screenshotToClipboard = pkgs.writeShellApplication {
    name = "screenshot-to-clipboard";
    runtimeInputs = with pkgs; [ grim slurp wl-clipboard libnotify ];
    text = ''
      geometry=$(slurp)
      grim -g "$geometry" -t png - | wl-copy --type image/png
      notify-send "Screenshot copied" "Selected area copied to clipboard."
    '';
  };

  legacyJava8 = import ../../custom_packages/temurin8-legacy.nix { inherit pkgs; };
  prismLauncher = pkgs.prismlauncher.override {
    jdks = with pkgs; [
      legacyJava8
      jdk25
      jdk21
      jdk17
      jdk8
    ];
  };
in
{
  # ── Linux desktop/user packages ─────────────────────
  home.packages = with pkgs; [
    qbittorrent
    mullvad
    ghostty
    fuzzel
    zed-editor
    obsidian
    screenshotToClipboard
    swaybg
    prismLauncher

    pavucontrol
    helvum
    luminance
    wlogout
    networkmanagerapplet
  ];

  # A compact GNOME-like shell surface for Niri: workspace navigation, clock,
  # and status controls. Click the brightness icon to reveal its inline slider;
  # hardware keys continue to provide immediate volume/brightness changes
  # through the bindings in dotfiles/niri/config.kdl.
  programs.waybar = {
    enable = true;
    package = patchedWaybar;
    systemd.enable = true;
    settings.mainBar = {
      layer = "top";
      position = "top";
      height = 34;
      spacing = 8;
      modules-left = [ "niri/workspaces" "custom/public-ip" "custom/shoreline-wind" ];
      modules-center = [ "clock" ];
      modules-right = [
        "bluetooth"
        "network"
        "group/volume"
        "group/brightness"
        "tray"
        "custom/power"
      ];

      "niri/workspaces" = {
        format = "{icon}";
        format-icons = {
          default = "○";
          active = "●";
        };
        persistent-workspaces."*" = [ 1 2 3 4 5 ];
      };

      clock = {
        format = "{:%a, %b %d  ·  %H:%M}";
        tooltip-format = "<big>{:%A, %B %d, %Y}</big>\n<tt><small>{calendar}</small></tt>";
      };

      bluetooth = {
        format = "";
        format-connected = " {device_alias}";
        format-disabled = "";
        tooltip-format = "Bluetooth: {status}";
        tooltip-format-connected = "{device_alias}";
        on-click = "blueman-manager";
      };

      network = {
        format-wifi = "  {signalStrength}%";
        format-ethernet = "󰈀  Wired";
        format-linked = "󰈀  Linked";
        format-disconnected = "󰖪 Offline";
        tooltip-format-wifi = "{essid} ({signalStrength}%)\nInterface: {ifname}\nLocal IP: {ipaddr}";
        tooltip-format-ethernet = "Interface: {ifname}\nLocal IP: {ipaddr}";
        on-click = "nm-connection-editor";
      };

      "custom/public-ip" = {
        exec = "${waybarPublicIp}/bin/waybar-public-ip";
        return-type = "json";
        interval = 300;
        on-click = "${pkgs.firefox}/bin/firefox 'https://ipconfig.io/'";
      };

      "custom/shoreline-wind" = {
        exec = "${waybarShorelineWind}/bin/waybar-shoreline-wind";
        return-type = "json";
        interval = 600;
        on-click = "${pkgs.firefox}/bin/firefox 'https://www.windy.com/37.432785/-122.091743/wind?37.432785,-122.091743,13'";
      };

      "group/volume" = {
        orientation = "inherit";
        drawer = {
          click-to-reveal = true;
          transition-duration = 200;
          transition-left-to-right = false;
        };
        modules = [ "pulseaudio" "pulseaudio/slider" ];
      };

      pulseaudio = {
        format = "{icon} {volume}%";
        format-bluetooth = " {icon} {volume}%";
        format-muted = "󰖁";
        format-icons = {
          default = [ "" "" "" ];
        };
        scroll-step = 1;
      };

      "pulseaudio/slider" = {
        min = 0;
        max = 100;
        orientation = "horizontal";
      };

      "group/brightness" = {
        orientation = "inherit";
        drawer = {
          click-to-reveal = true;
          transition-duration = 200;
          transition-left-to-right = false;
        };
        modules = [ "backlight" "backlight/slider" ];
      };

      backlight = {
        format = "󰃠 {percent}%";
        tooltip-format = "Monitor brightness: {percent}%";
        scroll-step = 10;
        min-brightness = 1.0;
      };

      "backlight/slider" = {
        min = 1;
        max = 100;
        orientation = "horizontal";
        interval = 1000;
      };

      tray = {
        icon-size = 16;
        spacing = 8;
      };

      "custom/power" = {
        format = "⏻";
        tooltip = true;
        tooltip-format = "Left click: turn off displays\nRight click: power menu";
        on-click = "${pkgs.niri}/bin/niri msg action power-off-monitors";
        on-click-right = "${pkgs.wlogout}/bin/wlogout";
      };
    };

    style = ''
      * {
        border: none;
        border-radius: 0;
        font-family: "JetBrainsMono Nerd Font", "Symbols Nerd Font", sans-serif;
        font-size: 13px;
        min-height: 0;
      }

      window#waybar {
        background: #1d2021;
        color: #ebdbb2;
        border-bottom: 1px solid #3c3836;
      }

      #workspaces { margin-left: 8px; }
      #workspaces button {
        color: #928374;
        padding: 0 6px;
      }
      #workspaces button.active { color: #fe8019; }
      #workspaces button:hover { background: #3c3836; }

      #clock {
        color: #ebdbb2;
        font-weight: 600;
        padding: 0 12px;
      }

      #bluetooth, #network, #custom-public-ip, #custom-shoreline-wind, #pulseaudio, #backlight, #tray, #custom-power {
        padding: 0 8px;
        color: #d5c4a1;
      }
      #custom-public-ip { color: #83a598; }
      #custom-shoreline-wind { color: #8ec07c; }
      #custom-public-ip.stale, #custom-shoreline-wind.stale { color: #fabd2f; }
      #custom-public-ip.error, #custom-shoreline-wind.error { color: #fb4934; }
      #bluetooth:hover, #network:hover, #pulseaudio:hover, #backlight:hover, #custom-power:hover {
        background: #3c3836;
        color: #fe8019;
      }
      #backlight-slider {
        min-width: 110px;
        padding: 0 14px;
      }
      #backlight-slider slider {
        min-height: 12px;
        min-width: 12px;
        border-radius: 999px;
        background: #ebdbb2;
        box-shadow: none;
      }
      #backlight-slider trough {
        min-height: 6px;
        border-radius: 999px;
        background: #504945;
      }
      #backlight-slider highlight {
        min-height: 6px;
        border-radius: 999px;
        background: #fe8019;
      }
      #pulseaudio-slider {
        min-width: 110px;
        padding: 0 14px;
      }
      #pulseaudio-slider slider {
        min-height: 12px;
        min-width: 12px;
        border-radius: 999px;
        background: #ebdbb2;
        box-shadow: none;
      }
      #pulseaudio-slider trough {
        min-height: 6px;
        border-radius: 999px;
        background: #504945;
      }
      #pulseaudio-slider highlight {
        min-height: 6px;
        border-radius: 999px;
        background: #b8bb26;
      }
      #pulseaudio.muted, #network.disconnected { color: #928374; }
      #custom-power {
        color: #fb4934;
        margin-right: 4px;
      }

      tooltip {
        background: #282828;
        border: 1px solid #504945;
        color: #ebdbb2;
      }
    '';
  };

  # Niri does not start a Polkit authentication agent for us. 1Password's
  # "Unlock using system authentication" uses Polkit/PAM, so keep an agent
  # running in the graphical user session.
  services.polkit-gnome.enable = true;

  # Waybar already renders network and Bluetooth status modules. Suppress only
  # their tray applets so the tray remains available to 1Password and other
  # applications without showing duplicate network/Bluetooth icons.
  xdg.configFile."autostart/nm-applet.desktop" = {
    force = true;
    text = ''
      [Desktop Entry]
      Type=Application
      Name=NetworkManager Applet
      Hidden=true
    '';
  };
  xdg.configFile."autostart/blueman.desktop" = {
    force = true;
    text = ''
      [Desktop Entry]
      Type=Application
      Name=Blueman Applet
      Hidden=true
    '';
  };

  # Open folders in Nautilus from browsers, launchers, and other applications.
  xdg.mimeApps = {
    enable = true;
    defaultApplications."inode/directory" = [ "org.gnome.Nautilus.desktop" ];
  };

  programs.bash.initExtra = ''
    alias switch="sudo nixos-rebuild switch --flake ."
  '';

  home.file.".zshrc".text = lib.mkAfter ''
    alias switch="sudo nixos-rebuild switch --flake ."
  '';


  # Niri config lives in dotfiles/niri/config.kdl. Home Manager still
  # substitutes absolute Nix store paths for launchers so the session does not
  # depend on whatever PATH niri/systemd inherited.
  xdg.configFile."niri/config.kdl" = {
    force = true;
    text = builtins.replaceStrings
      [
        "@ghostty@"
        "@fuzzel@"
        "@niriWindowSwitcher@"
        "@firefox@"
        "@bluemanManager@"
        "@luminance@"
        "@wpctl@"
        "@playerctl@"
        "@monitorBrightness@"
        "@onePassword@"
        "@swaybg@"
        "@bigSurWallpaper@"
        "@screenshotToClipboard@"
        "@cursorTheme@"
        "@cursorSize@"
      ]
      [
        "${pkgs.ghostty}/bin/ghostty"
        "${pkgs.fuzzel}/bin/fuzzel"
        "${niriWindowSwitcher}/bin/niri-window-switcher"
        "${pkgs.firefox}/bin/firefox"
        "${pkgs.blueman}/bin/blueman-manager"
        "${pkgs.luminance}/bin/com.sidevesh.Luminance"
        "${pkgs.wireplumber}/bin/wpctl"
        "${pkgs.playerctl}/bin/playerctl"
        "${monitorBrightness}/bin/monitor-brightness"
        "${pkgs._1password-gui}/bin/1password"
        "${pkgs.swaybg}/bin/swaybg"
        "${bigSurWallpaper}"
        "${screenshotToClipboard}/bin/screenshot-to-clipboard"
        "Bibata-Modern-Ice"
        "24"
      ]
      (builtins.readFile ../../dotfiles/niri/config.kdl);
  };

  # Steam is installed, but do not auto-launch it while the niri session and
  # xwayland-satellite setup are being stabilized. Steam may create XDG
  # autostart entries itself, so remove the common variants on activation.
  home.activation.disableSteamAutostart = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    rm -f \
      "$HOME/.config/autostart/steam.desktop" \
      "$HOME/.config/autostart/Steam.desktop" \
      "$HOME/.config/autostart/steam"*.desktop \
      "$HOME/.config/autostart/Steam"*.desktop
  '';
}

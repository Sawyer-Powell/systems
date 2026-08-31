# My fun emacs configuration

![doraemon](logo.png)

### System dependencies

#### Required
- JetBrains Mono fonts
- Node.js and the MathJax preview helper:
  1. `npm install --global git+https://gitlab.com/matsievskiysv/math-preview`
  2. `npm pkg set 'overrides.@xmldom/xmldom=0.9.12' --prefix "$(npm root --global)/math-preview"`
  3. `npm install --prefix "$(npm root --global)/math-preview"`

Language servers and the ECA Emacs client are managed by the systems configuration.
Run `M-x eca` to start the AI assistant.

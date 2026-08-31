;;; init.el --- Sawyer's Emacs configuration -*- lexical-binding: t; -*-

;;; Packages

(require 'package)
(setq custom-file (expand-file-name "custom.el" user-emacs-directory))

;; GUI applications on macOS do not inherit the interactive shell's PATH.
;; Expose Home Manager packages to Emacs and processes such as Eglot servers.
(let ((home-manager-bin
       (format "/etc/profiles/per-user/%s/bin" (user-login-name))))
  (when (file-directory-p home-manager-bin)
    (add-to-list 'exec-path home-manager-bin)
    (setenv "PATH" (concat home-manager-bin path-separator
                           (or (getenv "PATH") "")))))

;; Some macOS-only helpers, including the MathJax preview process, are
;; installed by Homebrew rather than Home Manager.
(when (eq system-type 'darwin)
  (let ((homebrew-bin "/opt/homebrew/bin"))
    (when (file-directory-p homebrew-bin)
      (add-to-list 'exec-path homebrew-bin)
      (setenv "PATH" (concat homebrew-bin path-separator
                             (or (getenv "PATH") ""))))))

;; Homebrew's libgccjit needs the macOS SDK path when compiling Elisp.
(when (eq system-type 'darwin)
  (require 'comp)
  (add-to-list 'native-comp-driver-options
               "-L/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk/usr/lib"))

(add-to-list 'package-archives '("melpa" . "https://melpa.org/packages/") t)
(setq evil-want-C-u-scroll t
      evil-want-keybinding nil)
(package-initialize)

(setq package-selected-packages
      '(corfu dashboard doom-themes eca evil evil-collection go-mode ivy magit
        markdown-mode math-preview obsidian rust-mode typescript-mode
        visual-fill-column))

;; Homebrew provides Emacs itself on macOS; Linux receives these packages from
;; Nix. Install anything missing without blocking first boot on a prompt.
(unless (seq-every-p #'package-installed-p package-selected-packages)
  (package-refresh-contents)
  (package-install-selected-packages t))

(require 'package-vc)
(setq package-vc-selected-packages
      '((jj-mode :url "https://github.com/bolivier/jj-mode.el")))
(package-vc-install-selected-packages)

;;; Appearance

(load-theme 'doom-gruvbox t)
(display-time-mode 1)
(menu-bar-mode -1)
(tool-bar-mode -1)
(scroll-bar-mode -1)
(electric-pair-mode 1)

(setq default-frame-alist
      '((background-color . "gray12")
        (foreground-color . "gray85")
        (fullscreen . maximized)
        (vertical-scroll-bars . nil)))

;; This is the installed monospaced Nerd Font family.  FRAME=t applies the
;; setting to every graphical frame, including frames created later.
(when (display-graphic-p)
  (set-face-attribute 'default t :family "JetBrainsMono NFM" :height 140))

(setq-default truncate-lines t
              truncate-partial-width-windows nil
              tab-width 4)

(setq display-line-numbers-type 'relative
      display-line-numbers-width 3)
(global-display-line-numbers-mode 1)

;;; Files

(setq ring-bell-function 'ignore
      backup-directory-alist '(("." . "~/.emacs.d/backup"))
      backup-by-copying t
      version-control t
      delete-old-versions t
      kept-new-versions 20
      kept-old-versions 5
      auto-save-file-name-transforms `((".*" ,temporary-file-directory t)))

(when (file-exists-p "~/.emacs.d/secrets.el")
  (load-file "~/.emacs.d/secrets.el"))

;;; Dashboard

(require 'dashboard)
(setq initial-buffer-choice (lambda () (get-buffer-create "*dashboard*"))
      dashboard-banner-logo-title "Oh how I wish I were in vim"
      dashboard-startup-banner "~/.emacs.d/logo.png"
      dashboard-set-footer nil
      dashboard-center-content t
      dashboard-items '((recents . 5)))
(recentf-mode 1)
(dashboard-setup-startup-hook)

(defun goto-dashboard ()
  "Open the dashboard."
  (interactive)
  (dashboard-refresh-buffer)
  (switch-to-buffer "*dashboard*"))

(defun goto-config ()
  "Open this configuration."
  (interactive)
  (find-file user-init-file))

;;; Projects

(require 'project)

(defun sawyer-read-project-script (prompt)
  "Read a script beneath the current project's scripts directory using PROMPT."
  (let* ((root (project-root (project-current t)))
         (directory (expand-file-name "scripts" root)))
    (unless (file-directory-p directory)
      (user-error "Project has no scripts directory"))
    (expand-file-name
     (completing-read prompt
                      (directory-files directory nil
                                       directory-files-no-dot-files-regexp)
                      nil t)
     directory)))

(defun open-project-script ()
  "Open a script from the current project."
  (interactive)
  (find-file (sawyer-read-project-script "Open project script: ")))

(defun run-project-script ()
  "Run a script from the current project asynchronously."
  (interactive)
  (let ((script (sawyer-read-project-script "Run project script: ")))
    (async-shell-command (shell-quote-argument script)
                         (format "*%s*" (file-name-nondirectory script)))))

;;; ECA

;; Use an ordinary directional window so standard window commands can manage it.
(setq eca-chat-use-side-window nil)

;; Start an ECA session after Emacs finishes initializing.
(add-hook 'emacs-startup-hook #'eca)

;;; Evil

(require 'evil)
(evil-collection-init '(calendar calc dired magit))
(evil-mode 1)

(defun fix-cursor-indent ()
  "Indent the current line and enter Evil insert state."
  (interactive)
  (indent-according-to-mode)
  (evil-insert 1))

(defvar sawyer-leader-map (make-sparse-keymap))
(let ((bindings
       (list
        "<SPC>" #'fix-cursor-indent
        "re" #'eval-region
        ";" #'delete-other-windows
        "dv" #'describe-variable
        "df" #'describe-function
        "dm" #'describe-mode
        "dk" #'describe-key
        "dx" #'describe-package
        "ii" #'eldoc-doc-buffer
        "ig" #'xref-goto-xref
        "id" #'xref-find-definitions
        "ir" #'xref-find-references
        "if" #'xref-find-apropos
        "e" #'find-file
        "fs" #'flymake-start
        "fd" #'eldoc-print-current-symbol-info
        "fl" #'flymake-show-buffer-diagnostics
        "fg" #'flymake-goto-diagnostic
        "aa" #'eca
        "ab" #'eca-switch-to-chat
        "at" #'eca-chat-select
        "ai" #'eca-chat-inline-prompt
        "ar" #'eca-rewrite
        "ac" #'eca-completion-mode
        "aw" #'eca-workspaces
        "dd" #'goto-dashboard
        "dc" #'goto-config
        "Q" #'kill-buffer
        "c" #'calendar
        "g" #'jj-log
        "b" #'switch-to-buffer
        "ss" #'eshell
        "pf" #'project-find-file
        "pp" #'project-switch-project
        "pr" #'run-project-script
        "po" #'open-project-script
        "ps" #'project-shell
        "pt" #'project-compile
        "pk" #'project-kill-buffers
        "nn" #'obsidian-capture
        "no" #'obsidian-jump
        "ni" #'obsidian-insert-wikilink
        "nf" #'obsidian-follow-link-at-point
        "nr" #'obsidian-jump-back
        "nb" #'obsidian-backlink-jump
        "ns" #'obsidian-search
        "nv" #'obsidian-change-vault
        "ne" #'sawyer-edit-math-at-point
        "nm" #'sawyer-preview-math-at-point
        "nR" #'sawyer-render-markdown-buffer
        "q" #'evil-window-delete
        "l" #'evil-window-right
        "h" #'evil-window-left
        "j" #'evil-window-down
        "k" #'evil-window-up
        "L" #'evil-window-move-far-right
        "H" #'evil-window-move-far-left
        "J" #'evil-window-move-far-down
        "K" #'evil-window-move-far-up
        "/" #'evil-window-vsplit
        "." #'evil-window-split
        "w" #'evil-write
        "S" #'save-some-buffers
        "TAB" #'indent-region
        "'" #'comment-or-uncomment-region)))
  (while bindings
    (define-key sawyer-leader-map (kbd (pop bindings)) (pop bindings))))

(evil-define-key '(normal visual) 'global (kbd "SPC") sawyer-leader-map)
(evil-define-key 'motion 'global
  (kbd "j") #'evil-next-visual-line
  (kbd "k") #'evil-previous-visual-line)

(with-eval-after-load 'jj-mode
  (evil-make-overriding-map jj-mode-map 'normal)
  (evil-define-key 'normal jj-mode-map
    (kbd "j") #'magit-section-forward
    (kbd "k") #'magit-section-backward))

(add-hook 'special-mode-hook (lambda () (visual-line-mode -1)))

;;; Completion

(ivy-mode 1)
(require 'corfu)
(setq corfu-auto t)
(global-corfu-mode 1)

;;; Obsidian

;; elgrep writes its optional search history as an Elisp file without a
;; lexical-binding cookie, which causes a warning in newer Emacs versions.
(setq elgrep-data-file nil)

(require 'obsidian)
(require 'math-preview)
(require 'url-util)
(require 'visual-fill-column)
(setopt obsidian-directory (expand-file-name "~/Documents/sawyer-vault")
        markdown-enable-wiki-links t
        markdown-wiki-link-alias-first nil
        markdown-enable-highlighting-syntax t
        markdown-enable-math t
        markdown-fontify-code-blocks-natively t
        markdown-fontify-whole-heading-line t
        markdown-gfm-use-electric-backquote nil
        markdown-header-scaling t
        markdown-hide-markup nil
        markdown-max-image-size '(900 . 700))

(defvar-local sawyer-obsidian-image-overlays nil
  "Image overlays created for Obsidian-style embeds in the current buffer.")

(defun sawyer-obsidian-image-file (target)
  "Find the local vault file referenced by Obsidian embed TARGET."
  (let* ((target (url-unhex-string target))
         (relative-file (expand-file-name target default-directory))
         (vault-file (expand-file-name target obsidian-directory)))
    (or (and (file-regular-p relative-file) relative-file)
        (and (file-regular-p vault-file) vault-file)
        (car (directory-files-recursively
              obsidian-directory
              (concat (regexp-quote (file-name-nondirectory target)) "\\'")
              nil)))))

(defun sawyer-remove-obsidian-images ()
  "Remove rendered Obsidian image embeds from the current buffer."
  (mapc #'delete-overlay sawyer-obsidian-image-overlays)
  (setq sawyer-obsidian-image-overlays nil))

(defun sawyer-display-obsidian-images ()
  "Render local Obsidian image embeds such as ![[image.png|600]]."
  (sawyer-remove-obsidian-images)
  (when (and (display-images-p) (obsidian-file-p))
    (save-excursion
      (goto-char (point-min))
      (while (re-search-forward
              "!\\[\\[\\([^]|#]+\\)\\(?:#[^]|]+\\)?\\(?:|\\([0-9]+\\)\\)?\\]\\]"
              nil t)
        (let* ((file (sawyer-obsidian-image-file
                      (match-string-no-properties 1)))
               (width (and (match-string 2)
                           (string-to-number (match-string 2))))
               (image (and file
                           (ignore-errors
                             (create-image file nil nil
                                           :max-width (or width 900)
                                           :max-height 700)))))
          (when image
            (let ((overlay (make-overlay (match-beginning 0) (match-end 0))))
              (overlay-put overlay 'display image)
              (overlay-put overlay 'evaporate t)
              (push overlay sawyer-obsidian-image-overlays))))))))

(defun sawyer-render-markdown-buffer ()
  "Refresh inline images and MathJax equations in a Markdown buffer."
  (interactive)
  (when (and (derived-mode-p 'markdown-mode) (display-images-p))
    (markdown-remove-inline-images)
    (markdown-display-inline-images)
    (sawyer-display-obsidian-images)
    (math-preview-clear-all)
    (math-preview-all)))

(defun sawyer-edit-math-at-point ()
  "Reveal the source of the rendered equation at point for editing."
  (interactive)
  (math-preview-clear-at-point))

(defun sawyer-preview-math-at-point ()
  "Render the LaTeX equation at point."
  (interactive)
  (math-preview-at-point))

(defun sawyer-render-markdown-after-open ()
  "Render the current Markdown buffer once Emacs is idle."
  (let ((buffer (current-buffer)))
    (run-with-idle-timer
     0.25 nil
     (lambda ()
       (when (buffer-live-p buffer)
         (with-current-buffer buffer
           (sawyer-render-markdown-buffer)))))))

(defun sawyer-setup-markdown-buffer ()
  "Use a readable, rendered layout for Markdown notes."
  (visual-line-mode 1)
  (setq-local visual-fill-column-width 90
              visual-fill-column-center-text t)
  (visual-fill-column-mode 1)
  (display-line-numbers-mode -1)
  (remove-hook 'after-change-functions #'sawyer-schedule-markdown-render t)
  (add-hook 'after-save-hook #'sawyer-render-markdown-buffer nil t)
  (sawyer-render-markdown-after-open))

(add-hook 'markdown-mode-hook #'sawyer-setup-markdown-buffer)
(define-key obsidian-mode-map (kbd "C-c C-l") #'obsidian-insert-wikilink)
(define-key obsidian-mode-map (kbd "C-c C-o") #'obsidian-follow-link-at-point)
(define-key obsidian-mode-map (kbd "C-c C-x C-e") #'sawyer-edit-math-at-point)
(define-key obsidian-mode-map (kbd "C-c C-x C-p") #'sawyer-preview-math-at-point)
(define-key obsidian-mode-map (kbd "C-c C-x C-r") #'sawyer-render-markdown-buffer)
(global-obsidian-mode 1)

;;; Language servers

(require 'eglot)
(dolist (hook '(c-mode-hook
                c++-mode-hook
                go-mode-hook
                python-mode-hook
                rust-mode-hook
                typescript-mode-hook))
  (add-hook hook #'eglot-ensure))

(setq eglot-ignored-server-capabilities '(:inlayHintProvider)
      eldoc-echo-area-prefer-doc-buffer t
      eldoc-echo-area-use-multiline-p nil
      flymake-no-changes-timeout 0.5)

(global-set-key (kbd "M-k") #'completion-at-point)
(global-set-key (kbd "M-i") #'eldoc-doc-buffer)
(global-set-key (kbd "<escape>") #'keyboard-escape-quit)

(when (file-exists-p custom-file)
  (load custom-file))

;;; init.el ends here

// ============= THEME-ROOT.JS - STATIC DEFAULT THEME (NO FIREBASE) =============

class ThemeRoot {
  constructor() {
    this.listeners = [];
    this.initialized = false;

    // Palette harmonisee avec les composants principaux du site
    this.colors = {
      text: {
        title: '#1F1E1C',
        subtitle: '#7A746B',
        body: '#4A4A4A',
        button: '#FFFFFF'
      },
      background: {
        general: '#FFFFFF',
        card: '#F5F5F5',
        button: '#C6A75E'
      },
      icon: {
        standard: '#1F1E1C',
        hover: '#C6A75E'
      }
    };

    // Typo élégante comme demandé
    this.typography = {
      family: "'Cormorant Garamond', serif",
      name: 'Cormorant Garamond',
      category: 'serif'
    };

    this.fonts = {
      primary: "'Cormorant Garamond', serif",
      secondary: "'Manrope', sans-serif"
    };

    this.init();
  }

  init() {
    if (this.initialized) return;
    this.applyToCSS();
    this.initialized = true;
    this.notifyListeners();
  }

  applyToCSS() {
    const root = document.documentElement;

    // Variables utilisées par les composants
    root.style.setProperty('--text-title', this.colors.text.title);
    root.style.setProperty('--text-subtitle', this.colors.text.subtitle);
    root.style.setProperty('--text-body', this.colors.text.body);
    root.style.setProperty('--text-button', this.colors.text.button);

    root.style.setProperty('--bg-general', this.colors.background.general);
    root.style.setProperty('--bg-card', this.colors.background.card);
    root.style.setProperty('--bg-button', this.colors.background.button);

    root.style.setProperty('--icon-standard', this.colors.icon.standard);
    root.style.setProperty('--icon-hover', this.colors.icon.hover);

    root.style.setProperty('--font-primary', this.fonts.primary);
    root.style.setProperty('--font-secondary', this.fonts.secondary);

    // Compatibilité anciennes variables
    root.style.setProperty('--primary', this.colors.text.title);
    root.style.setProperty('--secondary', this.colors.background.button);
    root.style.setProperty('--accent', this.colors.text.subtitle);
    root.style.setProperty('--luxury', this.colors.text.title);
    root.style.setProperty('--ivory', '#F5F1E8');
  }

  getColors() {
    return JSON.parse(JSON.stringify(this.colors));
  }

  getTypography() {
    return JSON.parse(JSON.stringify(this.typography));
  }

  getFonts() {
    return { ...this.fonts };
  }

  isLoaded() {
    return true;
  }

  subscribe(callback) {
    if (typeof callback === 'function') {
      this.listeners.push(callback);
      callback({
        colors: this.getColors(),
        typography: this.getTypography(),
        fonts: this.getFonts()
      });
    }

    return () => {
      this.listeners = this.listeners.filter(cb => cb !== callback);
    };
  }

  notifyListeners() {
    const themeData = {
      colors: this.getColors(),
      typography: this.getTypography(),
      fonts: this.getFonts()
    };
    this.listeners.forEach(cb => {
      try {
        cb(themeData);
      } catch (error) {
        console.error('❌ Theme listener error:', error);
      }
    });
  }

  static getInstance() {
    if (!ThemeRoot.instance) {
      ThemeRoot.instance = new ThemeRoot();
    }
    return ThemeRoot.instance;
  }
}

const theme = ThemeRoot.getInstance();
export default theme;

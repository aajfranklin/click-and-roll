function Popup() {
  this.utils = new Utils();
  this.tab = null;

  this.loadSiteList = () => {
    browser.storage.sync.get(null, res => {
      const sites = Object.keys(res).filter(key => key !== 'clickAndRoll' && key !== "dark" && key !== "reverse");

      let siteListHTML = '<ul>';
      sites.forEach(site => {
        siteListHTML += `<li>${site}</li>`;
      });

      siteListHTML += '</ul>';
      document.getElementById('sites-section').innerHTML = siteListHTML;
    })
  };

  this.toggleCheckbox = (id) => {
    const checkbox = document.getElementById(id);
    if (checkbox.getAttribute('checked') === 'checked') {
      checkbox.removeAttribute('checked');
    } else {
      checkbox.setAttribute('checked', 'checked');
    }
  };

  this.toggleOnOffSetting = (setting) => {
    return this.utils.isSettingOn(setting)
      .then(isSettingOn => {
        if (isSettingOn) {
          return this.utils.saveToSyncStorage(setting, '')
            .then(() => {
              this.utils.messageActiveTab({message: 'stop'});
              browser.browserAction.setIcon({path: '../assets/static/inactive32.png', tabId: this.tab.id});
            })
        } else {
          this.utils.removeFromSyncStorage(setting);
          return this.utils.isExtensionOn(this.utils.getTabUrl(this.tab))
            .then(isExtensionOnForDomain => {
              if (isExtensionOnForDomain) {
                this.utils.messageActiveTab({message: 'start'});
                browser.browserAction.setIcon({path: '../assets/static/active32.png', tabId: this.tab.id});
              }
            });
        }
      });
  };

  this.toggleSetting = (setting) => {
    return this.utils.isSettingOn(setting)
      .then(isOn => {
        if (setting === 'dark') this.applyColourScheme(!isOn);
        if (setting === 'reverse') this.utils.messageActiveTab({message: 'toggle-reverse', isOn: !isOn});
        if (isOn) {
          return this.utils.removeFromSyncStorage(setting);
        }
        return this.utils.saveToSyncStorage(setting, 'true');
      })
  };

  this.applyColourScheme = (isDark) => {
    this.utils.messageActiveTab({message: 'toggle-dark', isOn: isDark});
    if (isDark) {
      document.body.classList.add('dark-mode');
      return;
    }
    document.body.classList.remove('dark-mode');
  };

  this.addToggleAnimation = (slider) => {
    slider.classList.add('slider');
    slider.classList.remove('slider-initial');
  };

  this.initialiseSettings = () => {
    return this.utils.getActiveTab()
      .then(tab => {
        this.tab = tab;
        return this.utils.isSettingOn(this.utils.getTabUrl(this.tab));
      })
      .then(isOn => {
        if (isOn) this.toggleCheckbox('domain-toggle');
        return this.utils.isSettingOn('clickAndRoll');
      })
      .then(isOn => {
        if (isOn) this.toggleCheckbox('extension-toggle');
        return this.utils.isSettingOn('reverse');
      })
      .then(isOn => {
        if (isOn) this.toggleCheckbox('reverse-toggle');
        return this.utils.isSettingOn('dark');
      })
      .then(isOn => {
        if (isOn) {
          this.toggleCheckbox('dark-toggle');
          this.applyColourScheme(true);
        }
        this.loadSiteList();
      });
  };

  this.handleClick = (e) => {
    const targetIsToggle = e.target.id.indexOf('-toggle') !== -1;
    const targetIsTab = e.target.classList.contains('tab');
    const targetIsLink = e.target.href !== undefined;

    if (targetIsToggle) return this.handleToggle(e);
    if (targetIsTab) return this.updateActiveTab(e);
    if (targetIsLink) browser.tabs.create({url: e.target.href});
  };

  this.handleToggle = (e) => {
    const id = e.target.id;
    const slider = e.target.nextElementSibling;

    if (slider.classList.contains('slider-initial')) {
      this.addToggleAnimation(slider);
    }

    this.toggleCheckbox(id);
    if (id === 'domain-toggle') this.toggleOnOffSetting(this.utils.getTabUrl(this.tab)).then(() => this.loadSiteList());
    if (id === 'extension-toggle') this.toggleOnOffSetting('clickAndRoll');
    if (id === 'reverse-toggle') this.toggleSetting('reverse');
    if (id === 'dark-toggle') this.toggleSetting('dark');
  };

  this.updateActiveTab = (e) => {
    const tabs = document.getElementsByClassName('tab');
    for (let tab of tabs) tab.classList.remove('active');
    e.target.classList.add('active');

    const tabSections = document.getElementsByClassName('tab-section');
    for (let section of tabSections) section.classList.remove('active');
    document.getElementById(`${e.target.id}-section`).classList.add('active');
  };
}

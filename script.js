// script.js - Fully Fixed with Modern Notifications
const OMAN_TIMEZONE = "Asia/Muscat";
const MODE_TRANSITION_MS = 260;
const SYNC_INTERVAL_MS = 1000;
const GPS_RETRY_MS = 30000;
const NTP_RETRY_MS = 10000;

// Modern Notification System - ADDED
class NotificationManager {
  constructor() {
    this.container = this.createContainer();
    this.activeNotifications = [];
  }

  createContainer() {
    const div = document.createElement('div');
    div.id = 'notification-container';
    div.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 10000;
      display: flex;
      flex-direction: column;
      gap: 12px;
      font-family: system-ui, -apple-system, sans-serif;
      max-width: 420px;
      pointer-events: none;
    `;
    document.body.appendChild(div);
    return div;
  }

  show(message, type = 'info', duration = 6000) {
    const id = Date.now() + Math.random();
    const notification = document.createElement('div');
    const colors = {
      success: { bg: '#ecfdf5', border: '#10b981', icon: '#059669', text: '#065f46', iconSvg: '✓' },
      error: { bg: '#fef2f2', border: '#ef4444', icon: '#dc2626', text: '#991b1b', iconSvg: '✕' },
      warning: { bg: '#fffbeb', border: '#f59e0b', icon: '#d97706', text: '#92400e', iconSvg: '⚠' },
      info: { bg: '#eff6ff', border: '#3b82f6', icon: '#2563eb', text: '#1e40af', iconSvg: 'ℹ' }
    };
    
    const theme = colors[type];
    
    notification.style.cssText = `
      background: ${theme.bg};
      border-left: 4px solid ${theme.border};
      padding: 16px;
      border-radius: 12px;
      box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04);
      animation: slideIn 0.4s cubic-bezier(0.16, 1, 0.3, 1);
      position: relative;
      overflow: hidden;
      pointer-events: auto;
    `;
    
    notification.innerHTML = `
      <div style="display: flex; align-items: flex-start; gap: 12px;">
        <div style="color: ${theme.icon}; flex-shrink: 0; margin-top: 2px; font-size: 18px; font-weight: bold;">
          ${theme.iconSvg}
        </div>
        <div style="flex: 1; min-width: 0;">
          <div style="font-weight: 600; color: ${theme.text}; font-size: 14px; margin-bottom: 4px; line-height: 1.4;">
            ${type === 'success' ? 'Success' : type === 'error' ? 'Error' : type === 'warning' ? 'Warning' : 'Information'}
          </div>
          <div style="color: ${theme.text}; opacity: 0.9; font-size: 13px; line-height: 1.5;">
            ${message}
          </div>
        </div>
        <button class="close-btn" style="background: none; border: none; color: ${theme.text}; opacity: 0.5; cursor: pointer; font-size: 18px; padding: 0; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; border-radius: 4px; transition: all 0.2s; pointer-events: auto;">
          ×
        </button>
      </div>
      ${duration > 0 ? `<div style="position: absolute; bottom: 0; left: 0; height: 3px; background: ${theme.border}; opacity: 0.3; animation: progress ${duration}ms linear forwards;"></div>` : ''}
    `;

    // Add styles if not present
    if (!document.getElementById('notification-styles')) {
      const style = document.createElement('style');
      style.id = 'notification-styles';
      style.textContent = `
        @keyframes slideIn {
          from { transform: translateX(120%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes slideOut {
          from { transform: translateX(0); opacity: 1; }
          to { transform: translateX(120%); opacity: 0; }
        }
        @keyframes progress {
          from { width: 100%; }
          to { width: 0%; }
        }
        .close-btn:hover { opacity: 1 !important; background: rgba(0,0,0,0.05) !important; }
      `;
      document.head.appendChild(style);
    }

    // Close button handler
    const closeBtn = notification.querySelector('.close-btn');
    closeBtn.onclick = () => this.close(notification, id);

    this.container.appendChild(notification);
    this.activeNotifications.push({ id, element: notification });

    // Auto remove
    if (duration > 0) {
      setTimeout(() => this.close(notification, id), duration);
    }

    return id;
  }

  close(element, id) {
    if (!element.parentNode) return;
    element.style.animation = 'slideOut 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards';
    setTimeout(() => {
      element.remove();
      this.activeNotifications = this.activeNotifications.filter(n => n.id !== id);
    }, 300);
  }

  clearAll() {
    this.activeNotifications.forEach(n => this.close(n.element, n.id));
  }
}

// GPS Time Synchronization Manager - FIXED
class GPSTimeSync {
  constructor() {
    this.sources = {
      GPS_ANTENNA: 'gps-antenna',
      GPS_RECEIVER: 'gps-receiver',
      INTERNET_NTP: 'internet-ntp',
      LOCAL: 'local'
    };
    
    this.currentSource = this.sources.LOCAL;
    this.timeOffset = 0;
    this.lastSyncTime = null;
    this.isLocked = false;
    this.syncInterval = null;
    this.proxyUrl = 'http://localhost:3000';
    this.eventTarget = new EventTarget();
    this.notifications = new NotificationManager();
    this.hasShownInitialSync = false;
  }

  async init() {
    console.log('GPSTimeSync: Initializing...');
    await this.syncTime();
    this.startAutoSync();
    return this;
  }

  async syncTime() {
    try {
      // Priority 2: Try GPS Receiver via proxy
      const gpsResult = await this.fetchGPSTime();
      if (gpsResult.success && gpsResult.timestamp) {
        this.updateTimeSource(gpsResult, this.sources.GPS_RECEIVER);
        this.dispatchUpdate(gpsResult);
        if (!this.hasShownInitialSync) {
          this.showSyncNotification(gpsResult, 'GPS Receiver');
        }
        return gpsResult;
      }
    } catch (error) {
      console.warn('GPS Receiver failed:', error.message);
    }

    try {
      // Priority 3: Try Internet/NTP
      const ntpResult = await this.fetchNTPTime();
      if (ntpResult.success && ntpResult.timestamp) {
        this.updateTimeSource(ntpResult, this.sources.INTERNET_NTP);
        this.dispatchUpdate(ntpResult);
        if (!this.hasShownInitialSync) {
          this.showSyncNotification(ntpResult, 'Internet/NTP');
        }
        return ntpResult;
      }
    } catch (error) {
      console.warn('Internet/NTP failed:', error.message);
    }

    // Priority 4: Fallback to local time
    const localResult = this.getLocalTime();
    this.updateTimeSource(localResult, this.sources.LOCAL);
    this.dispatchUpdate(localResult);
    
    if (!this.hasShownInitialSync) {
      // Keep local fallback silent to avoid disruptive startup warnings.
      // Status is already visible in the sync bar and primary status card.
      this.hasShownInitialSync = true;
    }
    
    return localResult;
  }

  showSyncNotification(result, sourceName) {
    const isGPS = sourceName === 'GPS Receiver';
    const lockStatus = this.isLocked ? 'LOCKED' : 'NO LOCK';
    const lockColor = this.isLocked ? '#10b981' : '#f59e0b';
    
    this.notifications.show(
      `<div style="display: grid; gap: 4px;">
        <div><strong>Source:</strong> ${sourceName}</div>
        <div><strong>Date:</strong> ${result.date || 'N/A'}</div>
        <div><strong>Time:</strong> ${result.time || 'N/A'}</div>
        ${isGPS ? `<div><strong>Status:</strong> <span style="color: ${lockColor}; font-weight: 600;">${lockStatus}</span></div>` : ''}
       </div>`,
      isGPS && this.isLocked ? 'success' : isGPS ? 'warning' : 'info',
      6000
    );
    
    this.hasShownInitialSync = true;
  }

  async fetchGPSTime() {
    const response = await fetch(`${this.proxyUrl}/api/time`);
    if (!response.ok) {
      throw new Error(`GPS Proxy returned ${response.status}`);
    }
    const data = await response.json();
    
    // FIXED: Handle both old nested format and new flat format
    const date = data.date || (data.time && data.time.date);
    const time = data.time || (data.time && data.time.time);
    
    if (!date || !time) {
      throw new Error('Invalid GPS response: missing date/time');
    }
    
    return {
      success: data.success !== false,
      timestamp: data.timestamp || Date.now(),
      date: date,
      time: time,
      source: data.source || 'gps-receiver',
      raw: data.raw
    };
  }

  async fetchNTPTime() {
    const response = await fetch(`${this.proxyUrl}/api/time/ntp`);
    if (!response.ok) {
      throw new Error(`NTP Proxy returned ${response.status}`);
    }
    const data = await response.json();
    
    // FIXED: Handle both old nested format and new flat format
    const date = data.date || (data.time && data.time.date);
    const time = data.time || (data.time && data.time.time);
    
    return {
      success: data.success !== false,
      timestamp: data.timestamp || Date.now(),
      date: date,
      time: time,
      source: data.source || 'internet-ntp',
      rtt: data.rtt || 0
    };
  }

  getLocalTime() {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: OMAN_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    
    const parts = formatter.formatToParts(now);
    const date = `${parts.find(p => p.type === 'month').value}/${parts.find(p => p.type === 'day').value}/${parts.find(p => p.type === 'year').value}`;
    const time = `${parts.find(p => p.type === 'hour').value}:${parts.find(p => p.type === 'minute').value}:${parts.find(p => p.type === 'second').value}`;
    
    return {
      success: true,
      timestamp: now.getTime(),
      date: date,
      time: time,
      source: 'local'
    };
  }

  updateTimeSource(result, source) {
    const localNow = Date.now();
    this.timeOffset = result.timestamp - localNow;
    this.currentSource = source;
    this.lastSyncTime = new Date();
    
    // FIXED: Better lock status detection
    if (source === this.sources.GPS_RECEIVER) {
      const isDefaultDate = result.date === '01/01/2026' || 
                           result.date === '01/01/2000' ||
                           result.date === '01/01/1999' ||
                           (result.raw && (result.raw.includes('01/01/2026') || result.raw.includes('01/01/2000')));
      this.isLocked = !isDefaultDate;
    } else if (source === this.sources.GPS_ANTENNA) {
      this.isLocked = true;
    } else {
      this.isLocked = false;
    }
    
    console.log(`Time synced from ${source}: ${result.date} ${result.time} (${this.timeOffset}ms offset), Locked: ${this.isLocked}`);
  }

  dispatchUpdate(result) {
    const event = new CustomEvent('gpstimeupdate', {
      detail: {
        timestamp: result.timestamp,
        date: result.date,
        time: result.time,
        source: this.currentSource,
        isLocked: this.isLocked,
        offset: this.timeOffset
      }
    });
    this.eventTarget.dispatchEvent(event);
    window.dispatchEvent(event);
  }

  getNow() {
    return new Date(Date.now() + this.timeOffset);
  }

  isGPSLocked() {
    return this.isLocked;
  }

  getCurrentSource() {
    return this.currentSource;
  }

  startAutoSync() {
    this.syncTime();
    this.syncInterval = setInterval(() => {
      this.syncTime();
    }, GPS_RETRY_MS);
  }

  stopAutoSync() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  addEventListener(type, callback) {
    this.eventTarget.addEventListener(type, callback);
  }

  removeEventListener(type, callback) {
    this.eventTarget.removeEventListener(type, callback);
  }
}

// Legacy SyncManager for backwards compatibility
class SyncManager {
  constructor(statusElement, gpsTimeSync) {
    this.statusElement = statusElement;
    this.gpsTimeSync = gpsTimeSync;
    this.hasSuccessfulSync = false;
    this.lastSyncTimestamp = null;
    this.lastRttMs = null;
    this.errorType = null;
    this.retryDelayMs = 30000;
    this.timeoutId = null;
  }

  calculateBackoff() {
    this.retryDelayMs = Math.min(this.retryDelayMs * 2, 300000);
    return this.retryDelayMs;
  }

  getNowFromSyncedClock() {
    return this.gpsTimeSync.getNow();
  }

  getDrift(now = Date.now()) {
    return now - this.getNowFromSyncedClock().getTime();
  }

  getRelativeLastSync() {
    if (!this.lastSyncTimestamp) {
      return "never";
    }
    const diff = Math.max(0, Date.now() - this.lastSyncTimestamp);
    const minutes = Math.floor(diff / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);
    return `${minutes}m ${seconds}s ago`;
  }

  formatStatus() {
    const source = this.gpsTimeSync.getCurrentSource();
    const locked = this.gpsTimeSync.isGPSLocked() ? "LOCKED" : "UNLOCKED";
    return `Source: ${source.toUpperCase()} | ${locked} | Last sync: ${this.getRelativeLastSync()}`;
  }

  async sync() {
    try {
      const result = await this.gpsTimeSync.syncTime();
      this.hasSuccessfulSync = true;
      this.lastSyncTimestamp = Date.now();
      this.errorType = null;
      this.retryDelayMs = 30000;
      this.statusElement.classList.remove("warn");
      this.statusElement.textContent = this.formatStatus();
      this.scheduleNext(this.retryDelayMs);
    } catch (error) {
      this.errorType = "network";
      this.statusElement.classList.add("warn");
      this.statusElement.textContent = `Sync failed: ${error.message}`;
      this.scheduleNext(this.calculateBackoff());
    }
  }

  scheduleNext(delay) {
    if (this.timeoutId) {
      window.clearTimeout(this.timeoutId);
    }
    this.timeoutId = window.setTimeout(() => this.sync(), delay);
  }

  cleanup() {
    if (this.timeoutId) {
      window.clearTimeout(this.timeoutId);
    }
  }
}

// GPS Display Manager
class GPSDisplayManager {
  constructor(elements, gpsTimeSync) {
    this.elements = elements;
    this.gpsTimeSync = gpsTimeSync;
    this.sourceColors = {
      'gps-antenna': 'source-gps',
      'gps-receiver': 'source-gps',
      'internet-ntp': 'source-internet',
      'local': 'source-local'
    };
  }

  init() {
    this.gpsTimeSync.addEventListener('gpstimeupdate', (e) => {
      this.updateDisplay(e.detail);
    });
  }

  updateDisplay(data) {
    if (!this.elements.sourceIndicator) return;
    
    const sourceClass = this.sourceColors[data.source] || 'source-local';
    this.elements.sourceIndicator.className = `source-badge ${sourceClass}`;
    this.elements.sourceIndicator.textContent = this.formatSourceName(data.source);
    
    if (this.elements.lockStatus) {
      this.elements.lockStatus.textContent = data.isLocked ? 'GPS Locked' : 'No GPS Lock';
    }
    if (this.elements.lockPulse) {
      this.elements.lockPulse.classList.toggle('locked', data.isLocked);
    }
    
    if (this.elements.lastSyncTime) {
      const now = new Date();
      this.elements.lastSyncTime.textContent = `Last sync: ${now.toLocaleTimeString()}`;
    }
    
    if (this.elements.offsetDisplay) {
      this.elements.offsetDisplay.textContent = `Offset: ${data.offset}ms`;
    }
    
    if (this.elements.syncStatus) {
      let statusText;
      let statusColor;
      
      if (data.source === 'gps-receiver') {
        if (data.isLocked) {
          statusText = 'GPS-disciplined oscillator locked';
          statusColor = '#008800';
        } else {
          statusText = 'GPS receiver time (no satellite lock)';
          statusColor = '#c06c00';
        }
      } else if (data.source === 'internet-ntp') {
        statusText = 'Using Internet/NTP fallback';
        statusColor = '#c06c00';
      } else {
        statusText = 'Using local computer time';
        statusColor = '#df2d2d';
      }
      
      this.elements.syncStatus.textContent = statusText;
      this.elements.syncStatus.style.color = statusColor;
    }
  }

  formatSourceName(source) {
    const names = {
      'gps-antenna': 'GPS ANTENNA',
      'gps-receiver': 'GPS RECEIVER',
      'internet-ntp': 'INTERNET/NTP',
      'local': 'LOCAL TIME'
    };
    return names[source] || source.toUpperCase();
  }
}


class GPSSystemStatusManager {
  constructor(elements) {
    this.elements = elements;
    this.pollMs = 5000;
    this.pollHandle = null;
    this.deviceIp = localStorage.getItem('gpsDeviceIp') || '';
    this.proxyUrl = localStorage.getItem('gpsProxyUrl') || 'http://localhost:3000';
  }

  init() {
    if (this.elements.gpsDeviceIpInput) {
      this.elements.gpsDeviceIpInput.value = this.deviceIp;
    }
    this.updateDeviceIpLabel();

    if (this.elements.saveGpsIpBtn) {
      this.elements.saveGpsIpBtn.addEventListener('click', () => {
        const nextIp = (this.elements.gpsDeviceIpInput?.value || '').trim();
        this.deviceIp = nextIp;
        localStorage.setItem('gpsDeviceIp', this.deviceIp);
        this.updateDeviceIpLabel();
        this.fetchAndRenderStatus();
      });
    }

    this.fetchAndRenderStatus();
    this.pollHandle = setInterval(() => this.fetchAndRenderStatus(), this.pollMs);
  }

  cleanup() {
    if (this.pollHandle) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
  }

  async fetchAndRenderStatus() {
    const endpoint = `${this.proxyUrl}/api/gps/status${this.deviceIp ? `?ip=${encodeURIComponent(this.deviceIp)}` : ''}`;
    const started = performance.now();

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      const response = await fetch(endpoint, { signal: controller.signal });
      clearTimeout(timeout);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const latencyMs = Math.round(performance.now() - started);
      const payloadText = await response.text();
      const parsed = this.parsePayload(payloadText);
      const normalized = this.normalizeStatus(parsed, latencyMs);
      normalized.ip = parsed.host || this.deviceIp || '--';
      this.renderStatus(normalized);
    } catch (error) {
      console.warn('GPS System Status fetch failed:', error.message);
      this.markDisconnected('GPS SYSTEM DISCONNECTED');
    }
  }

  parsePayload(payloadText) {
    try {
      return JSON.parse(payloadText);
    } catch (_) {
      const data = {};
      payloadText.split(/\r?\n/).forEach((line) => {
        const match = line.match(/^\s*([\w\s\-/.]+)\s*[:=]\s*(.+)\s*$/);
        if (!match) return;
        const key = match[1].trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
        data[key] = match[2].trim();
      });
      return data;
    }
  }

  normalizeStatus(data, latencyMs) {
    const pick = (...keys) => {
      for (const key of keys) {
        if (data[key] !== undefined && data[key] !== null && data[key] !== '') return data[key];
      }
      return '--';
    };

    const gpsLock = pick('gps_lock_status', 'lock_status', 'gps_lock');
    const holdover = pick('holdover_mode', 'holdover');

    return {
      reachable: 'Yes',
      ip: this.deviceIp,
      latency: `${latencyMs} ms`,
      connectionStatus: 'Online',
      gpsLockStatus: gpsLock,
      satellitesInView: pick('satellites_in_view', 'sv_in_view', 'sat_in_view'),
      satellitesUsed: pick('satellites_used', 'sv_used', 'sat_used'),
      signalStrength: pick('signal_strength', 'snr', 'signal'),
      gpsTime: pick('gps_time', 'time_gps'),
      utcTime: pick('utc_time', 'time_utc'),
      systemOffset: pick('system_time_offset', 'time_offset', 'offset'),
      leapSecondStatus: pick('leap_second_status', 'leap_seconds'),
      latitude: pick('latitude', 'lat'),
      longitude: pick('longitude', 'lon', 'longitude_deg'),
      altitude: pick('altitude', 'altitude_m', 'alt'),
      oscType: pick('oscillator_type', 'osc_type'),
      oscLockStatus: pick('oscillator_lock_status', 'osc_lock_status', 'osc_lock'),
      holdoverMode: holdover,
      frequencyOffset: pick('frequency_offset', 'freq_offset'),
      ppsStatus: pick('one_pps_status', 'pps_status', '1pps_status'),
      irigStatus: pick('irig_b_status', 'irig_status'),
      mhz10Status: pick('mhz_10_output_status', 'output_10mhz_status', '10mhz_output_status'),
      ntpEnabled: pick('ntp_enabled', 'ntp_server_enabled'),
      ntpStratum: pick('stratum_level', 'ntp_stratum'),
      ntpClients: pick('ntp_clients_connected', 'ntp_clients'),
      ntpSyncStatus: pick('synchronization_status', 'ntp_sync_status'),
      firmwareVersion: pick('firmware_version', 'fw_version'),
      systemUptime: pick('system_uptime', 'uptime'),
      deviceTemperature: pick('temperature', 'device_temperature'),
      alarmStatus: pick('alarm_status', 'alarms')
    };
  }

  renderStatus(status) {
    this.setIndicator(this.elements.gpsConnectionDot, true);
    this.setIndicator(this.elements.gpsLockDot, /lock|ok|yes|track/i.test(String(status.gpsLockStatus)));
    this.setIndicator(this.elements.oscLockDot, /lock|ok|yes/i.test(String(status.oscLockStatus)), /holdover/i.test(String(status.holdoverMode)));

    this.setText('gpsReachable', status.reachable);
    this.setText('gpsDeviceIp', status.ip);
    this.setText('gpsLatency', status.latency);
    this.setText('gpsConnectionStatus', status.connectionStatus);
    this.setText('gpsLockStatus', status.gpsLockStatus);
    this.setText('gpsSatellitesView', status.satellitesInView);
    this.setText('gpsSatellitesUsed', status.satellitesUsed);
    this.setText('gpsSignalStrength', status.signalStrength);
    this.setText('gpsTime', status.gpsTime);
    this.setText('utcTime', status.utcTime);
    this.setText('systemOffset', status.systemOffset);
    this.setText('leapSecondStatus', status.leapSecondStatus);
    this.setText('gpsLatitude', status.latitude);
    this.setText('gpsLongitude', status.longitude);
    this.setText('gpsAltitude', status.altitude);
    this.setText('oscType', status.oscType);
    this.setText('oscLockStatus', status.oscLockStatus);
    this.setText('holdoverMode', status.holdoverMode);
    this.setText('frequencyOffset', status.frequencyOffset);
    this.setText('ppsStatus', status.ppsStatus);
    this.setText('irigStatus', status.irigStatus);
    this.setText('mhz10Status', status.mhz10Status);
    this.setText('ntpEnabled', status.ntpEnabled);
    this.setText('ntpStratum', status.ntpStratum);
    this.setText('ntpClients', status.ntpClients);
    this.setText('ntpSyncStatus', status.ntpSyncStatus);
    this.setText('firmwareVersion', status.firmwareVersion);
    this.setText('systemUptime', status.systemUptime);
    this.setText('deviceTemperature', status.deviceTemperature);
    this.setText('alarmStatus', status.alarmStatus);

    this.setBannerState('GPS SYSTEM CONNECTED', 'up');
  }

  markDisconnected(message) {
    this.setIndicator(this.elements.gpsConnectionDot, false);
    this.setIndicator(this.elements.gpsLockDot, false);
    this.setIndicator(this.elements.oscLockDot, false);
    this.setText('gpsReachable', 'No');
    this.setText('gpsConnectionStatus', 'Offline');
    this.setText('gpsLatency', '--');
    this.setBannerState(message, 'down');
  }

  updateDeviceIpLabel() {
    this.setText('gpsDeviceIp', this.deviceIp || '--');
  }

  setText(key, value) {
    const element = this.elements[key];
    if (element) element.textContent = value ?? '--';
  }

  setBannerState(message, level) {
    if (!this.elements.gpsSystemBanner || !this.elements.gpsSystemBannerText) return;
    this.elements.gpsSystemBanner.classList.remove('status-up', 'status-down', 'status-warn');
    this.elements.gpsSystemBanner.classList.add(level === 'up' ? 'status-up' : level === 'warn' ? 'status-warn' : 'status-down');
    this.elements.gpsSystemBannerText.textContent = message;
  }

  setIndicator(dotElement, isGood, isWarning = false) {
    if (!dotElement) return;
    dotElement.classList.remove('status-green', 'status-red', 'status-yellow');
    if (isWarning) {
      dotElement.classList.add('status-yellow');
      return;
    }
    dotElement.classList.add(isGood ? 'status-green' : 'status-red');
  }
}

class DisplayManager {
  constructor(elements, syncManager, gpsTimeSync) {
    this.elements = elements;
    this.syncManager = syncManager;
    this.gpsTimeSync = gpsTimeSync;
    this.mode = "digital";
    this.showMilliseconds = this.resolveInitialPrecisionMode();
    this.darkMode = this.resolveInitialDarkMode();
    this.paused = false;
    this.lastDriftSecond = -1;
  }

  resolveInitialDarkMode() {
    const stored = localStorage.getItem("darkMode");
    if (stored !== null) {
      return stored === "1";
    }
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  resolveInitialPrecisionMode() {
    const stored = localStorage.getItem("precisionMode");
    if (stored !== null) {
      return stored === "1";
    }
    return true;
  }

  initVisualPreferences() {
    this.applyDarkMode(this.darkMode);
    this.applyPrecisionMode(this.showMilliseconds);
  }

  applyDarkMode(enabled) {
    this.darkMode = enabled;
    document.body.classList.toggle("dark-mode", enabled);
    this.elements.darkModeBtn.textContent = enabled ? "Light mode" : "Dark mode";
    this.elements.darkModeBtn.setAttribute("aria-pressed", String(enabled));
    localStorage.setItem("darkMode", enabled ? "1" : "0");
  }

  updateUrl(mode) {
    const url = new URL(window.location);
    
    if (mode === 'analog-only') {
      url.searchParams.set('mode', 'analog-only');
    } else if (mode === 'analog') {
      url.searchParams.set('mode', 'analog');
    } else if (mode === 'digital') {
      url.searchParams.set('mode', 'digital');
    } else {
      url.searchParams.delete('mode');
    }
    
    window.history.replaceState({}, '', url);
  }

  toggleDarkMode() { this.applyDarkMode(!this.darkMode); }
  togglePrecisionMode() { this.applyPrecisionMode(!this.showMilliseconds); }
  togglePause() { this.paused = !this.paused; }

  setPrecisionVisibility(isVisible) {
    this.elements.precisionToggleBtn.classList.toggle("hidden", !isVisible);
  }

  showSection(section) {
    section.classList.remove("hidden", "is-fading");
    section.classList.add("is-visible");
  }

  hideSection(section) {
    section.classList.add("is-fading");
    section.classList.remove("is-visible");
    window.setTimeout(() => {
      section.classList.add("hidden");
      section.classList.remove("is-fading");
    }, MODE_TRANSITION_MS);
  }

  setMode(mode) {
    this.mode = mode;
    this.updateUrl(mode);
    document.body.classList.remove("analog-only", "old-style");
    const isDigital = mode === "digital";
    if (isDigital) {
      this.showSection(this.elements.digitalClock);
      this.hideSection(this.elements.analogClock);
      this.setPrecisionVisibility(true);
    } else {
      this.setPrecisionVisibility(true);
      document.body.classList.add("old-style");
      this.showSection(this.elements.analogClock);
      this.hideSection(this.elements.digitalClock);
    }

    this.elements.digitalModeBtn.classList.toggle("active", isDigital);
    this.elements.analogModeBtn.classList.toggle("active", !isDigital);
    this.elements.analogOnlyBtn.classList.remove("active");
    this.elements.digitalModeBtn.setAttribute("aria-pressed", String(isDigital));
    this.elements.analogModeBtn.setAttribute("aria-pressed", String(!isDigital));
    this.elements.analogOnlyBtn.setAttribute("aria-pressed", "false");
  }

  setActiveTab(tab) {
    const isGps = tab === "gps-status";
    this.elements.clockTabPanel?.classList.toggle("hidden", isGps);
    this.elements.gpsStatusTabPanel?.classList.toggle("hidden", !isGps);
    this.elements.tabClockBtn?.classList.toggle("active", !isGps);
    this.elements.tabGpsStatusBtn?.classList.toggle("active", isGps);
    this.elements.tabClockBtn?.setAttribute("aria-pressed", String(!isGps));
    this.elements.tabGpsStatusBtn?.setAttribute("aria-pressed", String(isGps));
  }

  setAnalogOnlyMode() {
    this.setActiveTab("clock");
    this.mode = "analog-only";
    this.updateUrl('analog-only');
    document.body.classList.remove("old-style");
    document.body.classList.add("analog-only");
    this.elements.digitalClock.classList.add("hidden");
    this.elements.analogClock.classList.remove("hidden");
    this.elements.digitalModeBtn.classList.remove("active");
    this.elements.analogModeBtn.classList.remove("active");
    this.elements.analogOnlyBtn.classList.add("active");
    this.setPrecisionVisibility(true);
  }

  applyPrecisionMode(enabled) {
    this.showMilliseconds = enabled;
    this.elements.millisecondsTile.classList.toggle("hidden", !enabled);
    this.elements.precisionToggleBtn.textContent = `Precision: ${enabled ? "ON" : "OFF"}`;
    this.elements.precisionToggleBtn.setAttribute("aria-pressed", String(enabled));
    localStorage.setItem("precisionMode", enabled ? "1" : "0");
  }

  updateDigital(oman, now) {
    this.elements.hours.textContent = String(oman.hour).padStart(2, "0");
    this.elements.minutes.textContent = String(oman.minute).padStart(2, "0");
    this.elements.seconds.textContent = String(oman.second).padStart(2, "0");
    this.elements.milliseconds.textContent = String(now.getUTCMilliseconds()).padStart(3, "0");
    this.elements.dateLine.textContent = new Intl.DateTimeFormat("en-GB", {
      timeZone: OMAN_TIMEZONE,
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
    }).format(now);
  }

  updateAnalog(oman, now) {
    const ms = now.getUTCMilliseconds();
    const secondProgress = oman.second + ms / 1000;
    const minuteProgress = oman.minute + secondProgress / 60;
    const hourProgress = (oman.hour % 12) + minuteProgress / 60;

    this.elements.secondHandGroup?.setAttribute("transform", `rotate(${secondProgress * 6} 400 400)`);
    this.elements.minuteHand?.setAttribute("transform", `rotate(${minuteProgress * 6} 400 400)`);
    this.elements.hourHand?.setAttribute("transform", `rotate(${hourProgress * 30} 400 400)`);

    const timeText = this.showMilliseconds
      ? `${String(oman.hour).padStart(2, "0")}:${String(oman.minute).padStart(2, "0")}:${String(oman.second).padStart(2, "0")}.${String(ms).padStart(3, "0")}`
      : `${String(oman.hour).padStart(2, "0")}:${String(oman.minute).padStart(2, "0")}:${String(oman.second).padStart(2, "0")}`;
    this.elements.analogTimeText && (this.elements.analogTimeText.textContent = timeText);
    this.elements.analogDateText && (this.elements.analogDateText.textContent = oman.date);
  }

  updateDrift(now) {
    if (!this.syncManager.hasSuccessfulSync) {
      this.elements.driftMonitor.classList.add("hidden");
      return;
    }
    const currentSecond = Math.floor(now.getTime() / 1000);
    if (currentSecond === this.lastDriftSecond) {
      return;
    }
    this.lastDriftSecond = currentSecond;

    const driftMs = this.syncManager.getDrift(now.getTime());
    const driftSec = driftMs / 1000;
    const abs = Math.abs(driftMs);
    const cls = abs < 100 ? "good" : abs < 1000 ? "warn" : "bad";

    this.elements.driftMonitor.classList.remove("hidden", "good", "warn", "bad");
    this.elements.driftMonitor.classList.add(cls);
    this.elements.driftMonitor.textContent = `Δ ${driftSec >= 0 ? "+" : ""}${driftSec.toFixed(3)}s`;
  }
}

class InputHandler {
  constructor(elements, displayManager) {
    this.elements = elements;
    this.displayManager = displayManager;
    this.listeners = [];
  }

  add(target, event, handler) {
    target.addEventListener(event, handler);
    this.listeners.push(() => target.removeEventListener(event, handler));
  }

  init() {
    this.add(this.elements.digitalModeBtn, "click", () => this.displayManager.setMode("digital"));
    this.add(this.elements.analogModeBtn, "click", () => this.displayManager.setMode("analog"));
    this.add(this.elements.analogOnlyBtn, "click", () => this.displayManager.setAnalogOnlyMode());
    this.add(this.elements.backToDigitalBtn, "click", () => this.displayManager.setMode("digital"));
    this.add(this.elements.darkModeBtn, "click", () => this.displayManager.toggleDarkMode());
    this.add(this.elements.precisionToggleBtn, "click", () => this.displayManager.togglePrecisionMode());
    this.add(this.elements.tabClockBtn, "click", () => this.displayManager.setActiveTab("clock"));
    this.add(this.elements.tabGpsStatusBtn, "click", () => this.displayManager.setActiveTab("gps-status"));
    this.add(document, "keydown", (e) => this.handleKeys(e));
  }

  handleKeys(e) {
    if (e.code === "Space") {
      e.preventDefault();
      this.displayManager.togglePause();
      return;
    }

    const key = e.key.toLowerCase();
    if (key === "1") this.displayManager.setMode("digital");
    if (key === "2") this.displayManager.setMode("analog");
    if (key === "3") this.displayManager.setAnalogOnlyMode();
    if (key === "d") this.displayManager.toggleDarkMode();
    if (key === "f") {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen?.();
      } else {
        document.exitFullscreen?.();
      }
    }
    if (e.key === "Escape" && document.body.classList.contains("analog-only")) {
      this.displayManager.setMode("digital");
    }
  }

  cleanup() {
    this.listeners.forEach((dispose) => dispose());
    this.listeners = [];
  }
}

class PrecisionClock {
  constructor() {
    this.elements = {
      hours: document.getElementById("hours"),
      minutes: document.getElementById("minutes"),
      seconds: document.getElementById("seconds"),
      milliseconds: document.getElementById("milliseconds"),
      millisecondsTile: document.getElementById("millisecondsTile"),
      dateLine: document.getElementById("dateLine"),
      syncStatus: document.getElementById("syncStatus"),
      ptbClockSvg: document.getElementById("ptbClockSvg"),
      hourHand: null,
      minuteHand: null,
      secondHand: null,
      secondHandGroup: null,
      analogDateText: null,
      analogTimeText: null,
      driftMonitor: document.getElementById("driftMonitor"),
      digitalClock: document.getElementById("digitalClock"),
      analogClock: document.getElementById("analogClock"),
      digitalModeBtn: document.getElementById("digitalModeBtn"),
      analogModeBtn: document.getElementById("analogModeBtn"),
      analogOnlyBtn: document.getElementById("analogOnlyBtn"),
      backToDigitalBtn: document.getElementById("backToDigitalBtn"),
      darkModeBtn: document.getElementById("darkModeBtn"),
      precisionToggleBtn: document.getElementById("precisionToggleBtn"),
      sourceIndicator: document.getElementById("sourceIndicator"),
      lockStatus: document.getElementById("lockStatus"),
      lockPulse: document.getElementById("lockPulse"),
      lastSyncTime: document.getElementById("lastSyncTime"),
      offsetDisplay: document.getElementById("offsetDisplay"),
      tabClockBtn: document.getElementById("tabClockBtn"),
      tabGpsStatusBtn: document.getElementById("tabGpsStatusBtn"),
      clockTabPanel: document.getElementById("clockTabPanel"),
      gpsStatusTabPanel: document.getElementById("gpsStatusTabPanel"),
      gpsDeviceIpInput: document.getElementById("gpsDeviceIpInput"),
      saveGpsIpBtn: document.getElementById("saveGpsIpBtn"),
      gpsSystemBanner: document.getElementById("gpsSystemBanner"),
      gpsSystemBannerText: document.getElementById("gpsSystemBannerText"),
      gpsConnectionDot: document.getElementById("gpsConnectionDot"),
      gpsLockDot: document.getElementById("gpsLockDot"),
      oscLockDot: document.getElementById("oscLockDot"),
      gpsReachable: document.getElementById("gpsReachable"),
      gpsDeviceIp: document.getElementById("gpsDeviceIp"),
      gpsLatency: document.getElementById("gpsLatency"),
      gpsConnectionStatus: document.getElementById("gpsConnectionStatus"),
      gpsLockStatus: document.getElementById("gpsLockStatus"),
      gpsSatellitesView: document.getElementById("gpsSatellitesView"),
      gpsSatellitesUsed: document.getElementById("gpsSatellitesUsed"),
      gpsSignalStrength: document.getElementById("gpsSignalStrength"),
      gpsTime: document.getElementById("gpsTime"),
      utcTime: document.getElementById("utcTime"),
      systemOffset: document.getElementById("systemOffset"),
      leapSecondStatus: document.getElementById("leapSecondStatus"),
      gpsLatitude: document.getElementById("gpsLatitude"),
      gpsLongitude: document.getElementById("gpsLongitude"),
      gpsAltitude: document.getElementById("gpsAltitude"),
      oscType: document.getElementById("oscType"),
      oscLockStatus: document.getElementById("oscLockStatus"),
      holdoverMode: document.getElementById("holdoverMode"),
      frequencyOffset: document.getElementById("frequencyOffset"),
      ppsStatus: document.getElementById("ppsStatus"),
      irigStatus: document.getElementById("irigStatus"),
      mhz10Status: document.getElementById("mhz10Status"),
      ntpEnabled: document.getElementById("ntpEnabled"),
      ntpStratum: document.getElementById("ntpStratum"),
      ntpClients: document.getElementById("ntpClients"),
      ntpSyncStatus: document.getElementById("ntpSyncStatus"),
      firmwareVersion: document.getElementById("firmwareVersion"),
      systemUptime: document.getElementById("systemUptime"),
      deviceTemperature: document.getElementById("deviceTemperature"),
      alarmStatus: document.getElementById("alarmStatus")
    };
    this.analogDial = this.elements.ptbClockSvg;
    
    this.gpsTimeSync = new GPSTimeSync();
    this.syncManager = new SyncManager(this.elements.syncStatus, this.gpsTimeSync);
    this.gpsDisplay = new GPSDisplayManager(this.elements, this.gpsTimeSync);
    this.displayManager = new DisplayManager(this.elements, this.syncManager, this.gpsTimeSync);
    this.gpsSystemStatus = new GPSSystemStatusManager(this.elements);
    this.inputHandler = new InputHandler(this.elements, this.displayManager);
    this.rafId = null;
    this.boundVisibility = () => this.handleVisibilityChange();
    this.boundUnload = () => this.cleanup();
  }

  async init() {
    this.applyFavicon();
    this.handleLogoFallback();
    this.buildAnalogDial();
    this.displayManager.initVisualPreferences();
    this.displayManager.setActiveTab("clock");
    this.displayManager.setPrecisionVisibility(false);
    
    await this.gpsTimeSync.init();
    this.gpsDisplay.init();
    
    const urlMode = new URLSearchParams(window.location.search).get("mode");
    if (urlMode === 'analog-only') {
      this.displayManager.setAnalogOnlyMode();
    } else if (urlMode === 'analog') {
      this.displayManager.setMode('analog');
    } else if (urlMode === 'digital') {
      this.displayManager.setMode('digital');
    } else {
      this.displayManager.setMode("digital");
    }
    
    this.inputHandler.init();
    this.gpsSystemStatus.init();
    document.addEventListener("visibilitychange", this.boundVisibility);
    window.addEventListener("beforeunload", this.boundUnload);
    this.syncManager.sync();
    this.startRenderLoop();
  }

  applyFavicon() {
    let favicon = document.querySelector("link[rel='icon']");
    if (!favicon) {
      favicon = document.createElement("link");
      favicon.rel = "icon";
      document.head.append(favicon);
    }
    favicon.href = "images/cal logo.png";
  }

  handleLogoFallback() {
    const logos = Array.from(document.querySelectorAll("[data-logo]"));
    const probe = new Image();
    probe.onerror = () => {
      document.body.classList.add("no-logo");
      const placeholder = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80'%3E%3Crect width='80' height='80' rx='10' fill='%231f7ea1'/%3E%3Ctext x='40' y='46' fill='white' font-size='13' text-anchor='middle' font-family='Arial'%3ERAFO%3C/text%3E%3C/svg%3E";
      logos.forEach((img) => {
        img.src = placeholder;
        img.alt = "Logo placeholder";
      });
    };
    probe.src = "images/cal logo.png";
  }

  buildAnalogDial() {
    const svg = this.analogDial;
    const ns = "http://www.w3.org/2000/svg";
    const make = (tag, attrs = {}) => {
      const el = document.createElementNS(ns, tag);
      Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, String(v)));
      return el;
    };

    svg.innerHTML = "";

    const defs = make("defs");
    const logoShadow = make("filter", { id: "logoShadow", x: "-40%", y: "-40%", width: "180%", height: "180%" });
    logoShadow.append(make("feDropShadow", { dx: "1.4", dy: "1.6", stdDeviation: "2", "flood-color": "#0f4358", "flood-opacity": "0.55" }));
    defs.append(logoShadow);
    svg.append(defs);

    svg.append(make("rect", { x: 0, y: 0, width: 800, height: 800, fill: "#e8e8e8" }));
    svg.append(make("circle", { cx: 400, cy: 400, r: 380, fill: "none", stroke: "#1a6b8c", "stroke-width": 6 }));

    const tickGroup = make("g", { id: "ticks" });
    for (let i = 0; i < 60; i += 1) {
      const angle = ((i * 6 - 90) * Math.PI) / 180;
      const isHour = i % 5 === 0;
      const outerRadius = 370;
      const length = isHour ? 25 : 15;
      const innerRadius = outerRadius - length;
      const x1 = 400 + innerRadius * Math.cos(angle);
      const y1 = 400 + innerRadius * Math.sin(angle);
      const x2 = 400 + outerRadius * Math.cos(angle);
      const y2 = 400 + outerRadius * Math.sin(angle);
      tickGroup.append(make("line", {
        x1: x1.toFixed(3),
        y1: y1.toFixed(3),
        x2: x2.toFixed(3),
        y2: y2.toFixed(3),
        stroke: isHour ? "#1a6b8c" : "#2a7a98",
        "stroke-width": isHour ? 8 : 4,
        "stroke-linecap": "round",
      }));
    }
    svg.append(tickGroup);

    const numbers = make("g", { id: "numbers", fill: "#1a6b8c", "font-family": "Arial, Helvetica, sans-serif", "font-size": 60, "text-anchor": "middle", "dominant-baseline": "middle" });
    for (let i = 1; i <= 12; i += 1) {
      const angle = ((i * 30 - 90) * Math.PI) / 180;
      const x = 400 + 300 * Math.cos(angle);
      const y = 400 + 300 * Math.sin(angle);
      const t = make("text", { x: x.toFixed(3), y: y.toFixed(3) });
      t.textContent = String(i);
      numbers.append(t);
    }
    svg.append(numbers);

    const logo = make("g", { transform: "translate(250 400)", opacity: 0.88, filter: "url(#logoShadow)" });
    logo.append(make("circle", { cx: -24, cy: -4, r: 30, fill: "#1a6b8c" }));
    logo.append(make("circle", { cx: -24, cy: -4, r: 20, fill: "none", stroke: "#e8e8e8", "stroke-width": 3 }));
    logo.append(make("line", { x1: -24, y1: -24, x2: -24, y2: 16, stroke: "#e8e8e8", "stroke-width": 3 }));
    logo.append(make("line", { x1: -44, y1: -4, x2: -4, y2: -4, stroke: "#e8e8e8", "stroke-width": 3 }));

    const dateText = make("text", { x: 400, y: 160, fill: "#1a6b8c", "font-size": 26, "font-family": "Arial, Helvetica, sans-serif", "text-anchor": "middle" });
    dateText.textContent = "06.03.2026";
    svg.append(dateText);

    const timeText = make("text", { x: 400, y: 655, fill: "#1a6b8c", "font-size": 25, "font-weight": 700, "font-family": "Arial, Helvetica, sans-serif", "text-anchor": "middle" });
    timeText.textContent = "01:36:21";
    svg.append(timeText);

    const tzText = make("text", { x: 400, y: 510, fill: "#1a6b8c", "font-size": 17, "font-family": "Arial, Helvetica, sans-serif", "text-anchor": "middle" });
    tzText.textContent = "MCT (UTC+04:00)";
    svg.append(tzText);

    const handsGroup = make("g", { id: "hands" });
    const hourHand = make("line", { x1: 400, y1: 400, x2: 400, y2: 230, stroke: "#1a6b8c", "stroke-width": 14, "stroke-linecap": "round", opacity: 0.86 });
    const minuteHand = make("line", { x1: 400, y1: 400, x2: 400, y2: 170, stroke: "#1f7699", "stroke-width": 10, "stroke-linecap": "round", opacity: 0.84 });
    const secondHandGroup = make("g");
    const secondHand = make("line", { x1: 400, y1: 435, x2: 400, y2: 140, stroke: "#d32f2f", "stroke-width": 3, "stroke-linecap": "round", opacity: 0.94 });
    const counterWeight = make("circle", { cx: 400, cy: 420, r: 10, fill: "#d32f2f" });
    secondHandGroup.append(secondHand, counterWeight);
    handsGroup.append(hourHand, minuteHand, secondHandGroup);
    svg.append(handsGroup);

    svg.append(make("circle", { cx: 400, cy: 400, r: 15, fill: "#d32f2f" }));
    svg.append(make("circle", { cx: 400, cy: 400, r: 5, fill: "#ffffff" }));

    this.elements.hourHand = hourHand;
    this.elements.minuteHand = minuteHand;
    this.elements.secondHand = secondHand;
    this.elements.secondHandGroup = secondHandGroup;
    this.elements.analogDateText = dateText;
    this.elements.analogTimeText = timeText;
  }

  getOmanParts(now) {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: OMAN_TIMEZONE,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour12: false,
    }).formatToParts(now);

    const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    return {
      hour: Number(map.hour),
      minute: Number(map.minute),
      second: Number(map.second),
      date: `${map.day}.${map.month}.${map.year}`,
    };
  }

  startRenderLoop() {
    if (this.rafId) {
      return;
    }
    const renderFrame = () => {
      if (!this.displayManager.paused) {
        const now = this.gpsTimeSync.getNow();
        const oman = this.getOmanParts(now);
        this.displayManager.updateDigital(oman, now);
        this.displayManager.updateAnalog(oman, now);
        this.displayManager.updateDrift(now);
      }
      if (this.syncManager.hasSuccessfulSync) {
        this.elements.syncStatus.textContent = this.syncManager.formatStatus();
      }
      this.rafId = requestAnimationFrame(renderFrame);
    };
    this.rafId = requestAnimationFrame(renderFrame);
  }

  handleVisibilityChange() {
    if (document.hidden) {
      if (this.rafId) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
      return;
    }
    this.startRenderLoop();
  }

  cleanup() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    document.removeEventListener("visibilitychange", this.boundVisibility);
    window.removeEventListener("beforeunload", this.boundUnload);
    this.inputHandler.cleanup();
    this.syncManager.cleanup();
    this.gpsTimeSync.stopAutoSync();
    this.gpsSystemStatus.cleanup();
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new PrecisionClock().init());
} else {
  new PrecisionClock().init();
}

// Global notification helper for inline scripts
window.showNotification = (message, type, duration) => {
  const nm = new NotificationManager();
  nm.show(message, type, duration);
};
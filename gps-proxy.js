// gps-proxy.js - Backend Node.js proxy for GPS receiver (using native net)
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');
const net = require('net');

const app = express();
const PORT = process.env.PORT || 3000;

// Track last connection time
let lastConnectionAttempt = 0;
const MIN_CONNECTION_INTERVAL = 5000;

// GPS Configuration
const GPS_DEFAULT_HOST = '192.168.50.2';
const GPS_PORT = 23;
const GPS_USERNAME = 'operator';
const GPS_PASSWORD = 'janus';

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files
const publicPath = path.resolve(__dirname);
app.use(express.static(publicPath));

// Helper: Format date consistently
function formatDate(date) {
  return new Intl.DateTimeFormat('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric'
  }).format(date);
}

function formatTime(date) {
  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(date);
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Helper: Get precise Internet time (UTC)
async function getPreciseInternetTime() {
  const timeSources = [
    'https://time.google.com',
    'https://www.time.gov',
    'https://www.microsoft.com'
  ];
  
  const measurements = await Promise.allSettled(
    timeSources.map(async (url) => {
      const start = Date.now();
      try {
        const response = await fetch(url, { method: 'HEAD', timeout: 5000 });
        const end = Date.now();
        return {
          url,
          rtt: end - start,
          date: response.headers.get('date')
        };
      } catch (e) {
        return { url, error: e.message };
      }
    })
  );
  
  const successful = measurements
    .filter(r => r.status === 'fulfilled' && r.value.date)
    .map(r => r.value);
  
  if (successful.length === 0) {
    throw new Error('No time servers reachable');
  }
  
  const best = successful.reduce((prev, curr) => 
    prev.rtt < curr.rtt ? prev : curr
  );
  
  const serverTime = new Date(best.date);
  const networkDelay = Math.round(best.rtt / 2);
  const adjustedTime = new Date(serverTime.getTime() + networkDelay);
  
  return {
    timestamp: adjustedTime.getTime(),
    sourcesReached: successful.length
  };
}

// Helper: Connect to GPS
function connectToGPS(command, expectOk = false, host = GPS_DEFAULT_HOST) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let buffer = '';
    let state = 'connecting';
    
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error('Connection timeout'));
    }, 15000);
    
    socket.connect(GPS_PORT, host, () => {
      console.log('TCP socket connected');
    });
    
    socket.on('data', (data) => {
      buffer += data.toString();
      
      if (state === 'connecting' && buffer.includes('USER NAME:')) {
        state = 'username';
        buffer = '';
        socket.write(GPS_USERNAME + '\r\n');
      }
      else if (state === 'username' && buffer.includes('PASSWORD:')) {
        state = 'password';
        buffer = '';
        socket.write(GPS_PASSWORD + '\r\n');
      }
      else if (state === 'password' && buffer.includes('LOGIN SUCCESSFUL!')) {
        state = 'loggedin';
        buffer = '';
        setTimeout(() => {
          state = 'command';
          socket.write(command);
        }, 500);
      }
      else if (state === 'command') {
        if (expectOk && buffer.includes('OK')) {
          state = 'done';
          clearTimeout(timeout);
          socket.destroy();
          resolve(buffer);
        }
        else if (!expectOk && (buffer.includes('F3') || buffer.match(/\d{2}\/\d{2}\/\d{4}/))) {
          state = 'done';
          clearTimeout(timeout);
          socket.destroy();
          resolve(buffer);
        }
      }
    });
    
    socket.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    
    socket.on('close', () => {
      if (state !== 'done') {
        clearTimeout(timeout);
        if (buffer.includes('OK') || buffer.includes('F3')) {
          resolve(buffer);
        } else {
          reject(new Error('Socket closed unexpectedly'));
        }
      }
    });
  });
}

// GET /api/time - Read GPS (receiver already returns Oman time in F69 UTC mode)
app.get('/api/time', async (req, res) => {
  const now = Date.now();
  const timeSinceLastAttempt = now - lastConnectionAttempt;
  
  if (timeSinceLastAttempt < MIN_CONNECTION_INTERVAL) {
    await new Promise(resolve => setTimeout(resolve, MIN_CONNECTION_INTERVAL - timeSinceLastAttempt));
  }
  
  lastConnectionAttempt = Date.now();
  
  try {
    const response = await connectToGPS('F3\r\n', false, GPS_DEFAULT_HOST);
    
    // Parse: "F3 UTC 03/08/2026 00:46:00" (already Oman time!)
    const match = response.match(/F3\s+\w+\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})/);
    if (!match) {
      // Fallback for older format
      const simpleMatch = response.match(/(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})/);
      if (!simpleMatch) throw new Error('Could not parse time');
      var [_, dateStr, timeStr] = simpleMatch;
    } else {
      var [_, dateStr, timeStr] = match;
    }
    
    // Receiver in F69 UTC mode with +4 offset already returns Oman time!
    // NO CONVERSION NEEDED
    const [month, day, year] = dateStr.split('/').map(Number);
    const [hours, minutes, seconds] = timeStr.split(':').map(Number);
    
    // Create timestamp from parsed time (treat as local Oman time)
    const omanDate = new Date(year, month - 1, day, hours, minutes, seconds);
    
    // FIXED: Return flat structure for frontend compatibility
    res.json({
      success: true,
      source: 'gps-receiver',
      date: dateStr,
      time: timeStr,
      timezone: 'GST (UTC+04:00)',
      timestamp: omanDate.getTime(),
      raw: response.trim()
    });
    
  } catch (error) {
    console.error('GPS Connection Error:', error.message);
    // FIXED: Return fallback data even on error
    const fallbackDate = new Date();
    res.status(503).json({
      success: false,
      source: 'gps-receiver',
      date: formatDate(fallbackDate),
      time: formatTime(fallbackDate),
      timestamp: fallbackDate.getTime(),
      error: error.message,
      available: false
    });
  }
});

// POST /api/time/set - Set GPS time (send Oman time directly!)
app.post('/api/time/set', async (req, res) => {
  try {
    let omanTime, source;
    
    if (req.body.useInternet) {
      // Internet time is UTC, add 4 hours to get Oman time
      const internetTime = await getPreciseInternetTime();
      omanTime = new Date(internetTime.timestamp + (4 * 60 * 60 * 1000));
      source = 'internet';
    } else {
      // PC time is Oman time
      omanTime = new Date();
      source = 'computer';
    }
    
    // Format Oman time for receiver (receiver in F69 UTC mode expects Oman time!)
    const mm = String(omanTime.getMonth() + 1).padStart(2, '0');
    const dd = String(omanTime.getDate()).padStart(2, '0');
    const yyyy = omanTime.getFullYear();
    const hh = String(omanTime.getHours()).padStart(2, '0');
    const min = String(omanTime.getMinutes()).padStart(2, '0');
    const ss = String(omanTime.getSeconds()).padStart(2, '0');
    
    // Send Oman time directly (receiver handles it as local time)
    const command = `F3 UTC ${mm}/${dd}/${yyyy} ${hh}:${min}:${ss}\r\n`;
    await connectToGPS(command, true, GPS_DEFAULT_HOST);
    
    // FIXED: Return flat structure
    res.json({
      success: true,
      message: 'GPS time set successfully',
      date: `${mm}/${dd}/${yyyy}`,
      time: `${hh}:${min}:${ss}`,
      timezone: 'GST (UTC+04:00)',
      source: source
    });
    
  } catch (error) {
    console.error('Set GPS Time Error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/time/ntp - Internet time (returns Oman time)
app.get('/api/time/ntp', async (req, res) => {
  try {
    const internetTime = await getPreciseInternetTime();
    const omanTime = new Date(internetTime.timestamp + (4 * 60 * 60 * 1000));
    
    // FIXED: Return flat structure
    res.json({
      success: true,
      source: 'internet-ntp',
      date: `${String(omanTime.getMonth()+1).padStart(2,'0')}/${String(omanTime.getDate()).padStart(2,'0')}/${omanTime.getFullYear()}`,
      time: `${String(omanTime.getHours()).padStart(2,'0')}:${String(omanTime.getMinutes()).padStart(2,'0')}:${String(omanTime.getSeconds()).padStart(2,'0')}`,
      timezone: 'GST (UTC+04:00)',
      timestamp: omanTime.getTime()
    });
  } catch (error) {
    // FIXED: Return fallback data even on error
    const fallbackDate = new Date();
    res.status(503).json({
      success: false,
      source: 'internet-ntp',
      date: formatDate(fallbackDate),
      time: formatTime(fallbackDate),
      timestamp: fallbackDate.getTime(),
      error: error.message,
      available: false
    });
  }
});


// GET /api/gps/status - Poll receiver status through backend proxy (avoids browser CORS/LAN restrictions)
app.get('/api/gps/status', async (req, res) => {
  const host = (req.query.ip || '').trim() || GPS_DEFAULT_HOST;

  const safe = (value, fallback = '--') => {
    if (value === undefined || value === null) return fallback;
    const normalized = String(value).trim();
    return normalized || fallback;
  };

  try {
    // F3 is supported on XLi and returns date/time + lock context in many deployments.
    const f3Raw = await connectToGPS('F3\r\n', false, host);
    const f3DateTime = f3Raw.match(/(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})/);
    const gpsDate = f3DateTime ? f3DateTime[1] : '--';
    const gpsTime = f3DateTime ? f3DateTime[2] : '--';

    // Try extra telemetry command (if unsupported, continue with defaults).
    let statusRaw = '';
    try {
      statusRaw = await connectToGPS('STAT?\r\n', false, host);
    } catch (_) {
      statusRaw = '';
    }

    const mergedRaw = `${f3Raw || ''}
${statusRaw || ''}`;
    const hasLock = /lock|tracking|track|sync/i.test(mergedRaw) && !/unlock|holdover/i.test(mergedRaw);
    const inHoldover = /holdover/i.test(mergedRaw);

    res.json({
      success: true,
      host,
      fetchedAt: Date.now(),
      gps_lock_status: hasLock ? 'LOCKED' : inHoldover ? 'HOLDOVER' : 'UNLOCKED',
      satellites_in_view: safe((mergedRaw.match(/sat(?:ellites)?\s*(?:in\s*view)?\s*[:=]\s*(\d{1,2})/i) || [])[1]),
      satellites_used: safe((mergedRaw.match(/sat(?:ellites)?\s*(?:used|tracked)\s*[:=]\s*(\d{1,2})/i) || [])[1]),
      signal_strength: safe((mergedRaw.match(/(?:snr|signal(?:\s*strength)?)\s*[:=]\s*([\d.]+\s*(?:dB|dBm)?)/i) || [])[1]),
      gps_time: gpsTime !== '--' ? `${gpsDate} ${gpsTime}` : '--',
      utc_time: gpsTime,
      system_time_offset: safe((mergedRaw.match(/offset\s*[:=]\s*([+-]?[\d.]+\s*(?:ns|us|ms|s))/i) || [])[1]),
      leap_second_status: safe((mergedRaw.match(/leap\s*seconds?\s*[:=]\s*([+\-]?\d+)/i) || [])[1]),
      latitude: safe((mergedRaw.match(/lat(?:itude)?\s*[:=]\s*([+\-]?\d+(?:\.\d+)?)/i) || [])[1]),
      longitude: safe((mergedRaw.match(/lon(?:gitude)?\s*[:=]\s*([+\-]?\d+(?:\.\d+)?)/i) || [])[1]),
      altitude: safe((mergedRaw.match(/alt(?:itude)?\s*[:=]\s*([+\-]?\d+(?:\.\d+)?\s*(?:m|ft)?)/i) || [])[1]),
      oscillator_type: /rubidium|rb/i.test(mergedRaw) ? 'Rubidium' : /ocxo/i.test(mergedRaw) ? 'OCXO' : '--',
      oscillator_lock_status: hasLock ? 'LOCKED' : inHoldover ? 'HOLDOVER' : 'UNLOCKED',
      holdover_mode: inHoldover ? 'ACTIVE' : 'INACTIVE',
      frequency_offset: safe((mergedRaw.match(/freq(?:uency)?\s*offset\s*[:=]\s*([+-]?[\d.eE-]+\s*(?:Hz|ppb|ppm)?)/i) || [])[1]),
      one_pps_status: /1pps\s*[:=]?\s*(on|ok|enabled|active)/i.test(mergedRaw) ? 'ON' : '--',
      irig_b_status: /irig[- ]?b\s*[:=]?\s*(on|ok|enabled|active)/i.test(mergedRaw) ? 'ON' : '--',
      output_10mhz_status: /10\s*mhz\s*[:=]?\s*(on|ok|enabled|active)/i.test(mergedRaw) ? 'ON' : '--',
      ntp_enabled: /ntp\s*[:=]?\s*(on|enabled|yes)/i.test(mergedRaw) ? 'YES' : '--',
      stratum_level: safe((mergedRaw.match(/stratum\s*[:=]\s*(\d{1,2})/i) || [])[1]),
      ntp_clients_connected: safe((mergedRaw.match(/ntp\s*clients?\s*[:=]\s*(\d+)/i) || [])[1]),
      synchronization_status: hasLock ? 'SYNCHRONIZED' : inHoldover ? 'HOLDOVER' : 'UNLOCKED',
      firmware_version: safe((mergedRaw.match(/(?:firmware|fw)\s*(?:version)?\s*[:=]\s*([\w.\-]+)/i) || [])[1]),
      system_uptime: safe((mergedRaw.match(/uptime\s*[:=]\s*([^\r\n]+)/i) || [])[1]),
      temperature: safe((mergedRaw.match(/temp(?:erature)?\s*[:=]\s*([+-]?[\d.]+\s*(?:C|°C|F|°F)?)/i) || [])[1]),
      alarm_status: /alarm\s*[:=]?\s*(none|ok|clear)/i.test(mergedRaw) ? 'CLEAR' : /alarm/i.test(mergedRaw) ? 'ACTIVE' : '--',
      raw: mergedRaw.trim()
    });
  } catch (error) {
    res.status(503).json({
      success: false,
      host,
      error: error.message,
      fetchedAt: Date.now()
    });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`GPS Server running on port ${PORT}`);
  console.log(`GPS Receiver: ${GPS_DEFAULT_HOST}:${GPS_PORT}`);
  console.log(`Mode: F69 UTC (receiver shows Oman time)`);
});
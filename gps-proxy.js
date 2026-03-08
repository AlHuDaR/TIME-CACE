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
const GPS_HOST = '192.168.50.2';
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
function connectToGPS(command, expectOk = false) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let buffer = '';
    let state = 'connecting';
    
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error('Connection timeout'));
    }, 15000);
    
    socket.connect(GPS_PORT, GPS_HOST, () => {
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
    const response = await connectToGPS('F3\r\n');
    
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
    await connectToGPS(command, true);
    
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

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`GPS Server running on port ${PORT}`);
  console.log(`GPS Receiver: ${GPS_HOST}:${GPS_PORT}`);
  console.log(`Mode: F69 UTC (receiver shows Oman time)`);
});
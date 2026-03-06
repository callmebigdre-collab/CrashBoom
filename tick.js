// Netlify function: fetches latest tick from Deriv
// No DERIV_TOKEN needed — Deriv's tick feed is public (no auth required for ticks)

const WebSocket = require('ws')

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' }
  }

  const symbol = event.queryStringParameters?.symbol || 'BOOM500'

  // Map frontend symbol names to Deriv symbol IDs
  const symbolMap = {
    BOOM500:   'BOOM500',
    CRASH1000: 'CRASH1000',
    CRASH300:  'CRASH300',
  }

  const derivSymbol = symbolMap[symbol] || symbol

  return new Promise((resolve) => {
    let settled = false

    function done(result) {
      if (settled) return
      settled = true
      try { if (ws && ws.readyState === WebSocket.OPEN) ws.close() } catch (_) {}
      clearTimeout(timer)
      resolve(result)
    }

    const timer = setTimeout(() => {
      done({
        statusCode: 504,
        headers,
        body: JSON.stringify({ error: 'Timeout: Deriv did not respond within 8s' })
      })
    }, 8000)

    let ws
    try {
      // app_id=1089 is Deriv's official demo app — no registration needed, works for all instruments
      ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=1089')
    } catch (e) {
      return done({ statusCode: 500, headers, body: JSON.stringify({ error: 'WS init failed: ' + e.message }) })
    }

    ws.on('open', () => {
      // No auth needed for public tick data — subscribe directly
      ws.send(JSON.stringify({ ticks: derivSymbol, subscribe: 1 }))
    })

    ws.on('message', (raw) => {
      let data
      try { data = JSON.parse(raw) } catch (e) {
        return done({ statusCode: 500, headers, body: JSON.stringify({ error: 'Parse error: ' + e.message }) })
      }

      if (data.msg_type === 'tick') {
        return done({
          statusCode: 200,
          headers,
          body: JSON.stringify({
            symbol: data.tick.symbol,
            price:  data.tick.quote,
            time:   data.tick.epoch,
            ok:     true
          })
        })
      }

      if (data.error) {
        return done({
          statusCode: 200,
          headers,
          body: JSON.stringify({ error: data.error.message + ' (code: ' + data.error.code + ')' })
        })
      }
    })

    ws.on('error', (e) => {
      done({ statusCode: 500, headers, body: JSON.stringify({ error: 'WS error: ' + e.message }) })
    })

    ws.on('close', (code, reason) => {
      if (!settled) {
        done({
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: 'WS closed: code=' + code + ' reason=' + (reason || 'unknown') })
        })
      }
    })
  })
}

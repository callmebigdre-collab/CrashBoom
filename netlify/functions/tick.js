// Netlify function: fetches tick history from Deriv (no auth needed)
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
  const mode   = event.queryStringParameters?.mode   || 'latest'

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
      done({ statusCode: 504, headers, body: JSON.stringify({ error: 'Timeout after 9s' }) })
    }, 9000)

    let ws
    try {
      ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=1089')
    } catch (e) {
      return done({ statusCode: 500, headers, body: JSON.stringify({ error: 'WS init: ' + e.message }) })
    }

    ws.on('open', () => {
      if (mode === 'history') {
        ws.send(JSON.stringify({
          ticks_history: symbol,
          count: 100,
          end: 'latest',
          style: 'ticks'
        }))
      } else {
        ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }))
      }
    })

    ws.on('message', (raw) => {
      let data
      try { data = JSON.parse(raw) } catch (e) {
        return done({ statusCode: 500, headers, body: JSON.stringify({ error: 'Parse: ' + e.message }) })
      }

      if (data.msg_type === 'history') {
        const prices = data.history?.prices || []
        const times  = data.history?.times  || []
        if (!prices.length) {
          return done({ statusCode: 200, headers, body: JSON.stringify({ error: 'No history data returned' }) })
        }
        return done({
          statusCode: 200,
          headers,
          body: JSON.stringify({
            symbol,
            history: prices.map((p, i) => ({ price: p, time: times[i] })),
            price: prices[prices.length - 1],
            time:  times[times.length - 1],
            ok: true
          })
        })
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

    ws.on('close', (code) => {
      if (!settled) done({ statusCode: 500, headers, body: JSON.stringify({ error: 'WS closed: ' + code }) })
    })
  })
}

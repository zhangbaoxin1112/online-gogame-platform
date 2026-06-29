import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',  // 允许外网访问
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        timeout: 60000,  // 60秒超时，适应移动端慢速上传
        proxyTimeout: 60000,
        // 添加错误处理避免影响其他请求
        configure: (proxy, options) => {
          proxy.on('error', (err, req, res) => {
            // 忽略 ECONNRESET 错误（客户端断开连接）
            if (err.code === 'ECONNRESET') return;
            console.log('API proxy error:', err.message);
            // 不要让错误传播，返回一个错误响应
            if (res && !res.headersSent) {
              res.writeHead(502, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, message: '代理错误，请重试' }));
            }
          });
        }
      },
      '/socket.io': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        ws: true,
        // 添加错误处理避免ECONNRESET崩溃
        configure: (proxy, options) => {
          proxy.on('error', (err, req, res) => {
            // 忽略 ECONNRESET 错误（客户端断开连接是正常现象）
            if (err.code === 'ECONNRESET') return;
            console.log('Socket proxy error:', err.message);
            // WebSocket错误不需要响应
          });
          // 处理 WebSocket 代理错误
          proxy.on('proxyReqWs', (proxyReq, req, socket) => {
            socket.on('error', (err) => {
              // 忽略 ECONNRESET，这是客户端断开时的正常现象
              if (err.code === 'ECONNRESET') return;
              console.log('WebSocket error:', err.message);
            });
          });
        }
      },
      '/uploads': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        configure: (proxy, options) => {
          proxy.on('error', (err, req, res) => {
            if (err.code === 'ECONNRESET') return;
            console.log('Uploads proxy error:', err.message);
          });
        }
      }
    }
  }
})

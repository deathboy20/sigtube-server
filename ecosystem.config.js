module.exports = {
  apps: [
    {
      name: 'sigtube-server',
      script: './index.js',
      instances: 'max',
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'development',
        PORT: 5000
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || 3000
      },
      
      // Logging
      output: 'logs/out.log',
      error: 'logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      
      // Restart policies
      max_restarts: 10,
      min_uptime: '10s',
      max_memory_restart: '500M',
      
      // Watch and ignore
      watch: false, // Set to true only in development
      ignore_watch: ['node_modules', 'logs', '.git'],
      
      // Graceful shutdown
      kill_timeout: 30000,
      wait_ready: true,
      listen_timeout: 10000,
      
      // Advanced features
      merge_logs: true,
      autorestart: true,
      
      // Monitoring
      monitor_interval: 100,
      
      // Environment variables from .env
      env_file: '.env'
    }
  ],
};
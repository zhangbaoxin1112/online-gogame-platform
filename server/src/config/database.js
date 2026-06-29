// 根据环境变量决定使用SQLite还是MySQL
if (process.env.USE_SQLITE === 'true') {
  // 使用SQLite（云托管/简单部署）
  module.exports = require('./database-sqlite');
} else {
  // 使用MySQL（本地开发/完整部署）
  const mysql = require('mysql2/promise');

  // 创建连接池
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'go_game',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });

  // 测试连接
  pool.getConnection()
    .then(connection => {
      console.log('✅ MySQL数据库连接成功');
      connection.release();
    })
    .catch(err => {
      console.error('❌ MySQL数据库连接失败:', err.message);
    });

  module.exports = pool;
}

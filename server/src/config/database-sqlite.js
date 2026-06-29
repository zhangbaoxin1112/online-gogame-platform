const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

// 确保数据目录存在
const dataDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'go_game.db');

let db = null;
let SQL = null;

// 初始化数据库
async function initDatabase() {
  SQL = await initSqlJs();
  
  // 尝试加载现有数据库
  try {
    if (fs.existsSync(dbPath)) {
      const buffer = fs.readFileSync(dbPath);
      db = new SQL.Database(buffer);
      console.log('✅ 加载现有SQLite数据库');
    } else {
      db = new SQL.Database();
      console.log('✅ 创建新SQLite数据库');
    }
  } catch (err) {
    db = new SQL.Database();
    console.log('✅ 创建新SQLite数据库');
  }

  // 创建表
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      email TEXT,
      avatar TEXT,
      score INTEGER DEFAULT 1500,
      wins INTEGER DEFAULT 0,
      losses INTEGER DEFAULT 0,
      draws INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_login DATETIME
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      black_player_id INTEGER,
      white_player_id INTEGER,
      winner_id INTEGER,
      board_size INTEGER DEFAULT 19,
      moves TEXT,
      result TEXT,
      game_type TEXT DEFAULT 'pvp',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ended_at DATETIME,
      FOREIGN KEY (black_player_id) REFERENCES users(id),
      FOREIGN KEY (white_player_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS score_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      game_id INTEGER,
      score_change INTEGER,
      score_after INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (game_id) REFERENCES games(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS friends (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      friend_id INTEGER,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (friend_id) REFERENCES users(id)
    )
  `);

  // 保存数据库
  saveDatabase();
  
  console.log('✅ SQLite数据库初始化完成');
}

// 保存数据库到文件
function saveDatabase() {
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
  }
}

// 定期保存数据库（每30秒）
setInterval(saveDatabase, 30000);

// 封装成Promise风格的接口，兼容mysql2的API
const pool = {
  // 等待数据库初始化
  _ready: initDatabase(),

  // 执行查询
  async execute(sql, params = []) {
    await this._ready;
    
    try {
      // 处理SQL语句中的NOW()函数
      sql = sql.replace(/NOW\(\)/gi, "datetime('now', 'localtime')");
      
      // 处理DATE_SUB等MySQL特有函数
      sql = sql.replace(/DATE_SUB\s*\(\s*NOW\s*\(\s*\)\s*,\s*INTERVAL\s+(\d+)\s+(\w+)\s*\)/gi, (match, num, unit) => {
        return `datetime('now', 'localtime', '-${num} ${unit.toLowerCase()}')`;
      });
      
      // 处理DATE()函数
      sql = sql.replace(/DATE\s*\(\s*([^)]+)\s*\)/gi, "date($1)");
      
      // 处理CURDATE()
      sql = sql.replace(/CURDATE\s*\(\s*\)/gi, "date('now', 'localtime')");

      if (sql.trim().toUpperCase().startsWith('SELECT')) {
        const stmt = db.prepare(sql);
        if (params.length > 0) {
          stmt.bind(params);
        }
        const rows = [];
        while (stmt.step()) {
          rows.push(stmt.getAsObject());
        }
        stmt.free();
        return [rows, null];
      } else if (sql.trim().toUpperCase().startsWith('INSERT')) {
        db.run(sql, params);
        const lastId = db.exec("SELECT last_insert_rowid() as id")[0]?.values[0][0] || 0;
        saveDatabase();
        return [{ insertId: lastId, affectedRows: db.getRowsModified() }, null];
      } else {
        db.run(sql, params);
        saveDatabase();
        return [{ affectedRows: db.getRowsModified() }, null];
      }
    } catch (error) {
      console.error('SQLite执行错误:', error.message, '\nSQL:', sql);
      throw error;
    }
  },

  // 查询（别名）
  async query(sql, params = []) {
    return this.execute(sql, params);
  },

  // 获取连接（兼容性）
  async getConnection() {
    await this._ready;
    return {
      execute: (sql, params) => pool.execute(sql, params),
      query: (sql, params) => pool.query(sql, params),
      release: () => {},
      beginTransaction: () => {},
      commit: () => saveDatabase(),
      rollback: () => {}
    };
  }
};

module.exports = pool;

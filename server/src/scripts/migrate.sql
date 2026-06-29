-- 围棋在线游戏数据库迁移脚本
-- 用于从旧版本升级到新版本（支持好友系统和多匹配模式）

-- 1. 修改用户表的默认积分为100
ALTER TABLE users MODIFY COLUMN score INT DEFAULT 100;

-- 2. 添加用户状态'matching'
ALTER TABLE users MODIFY COLUMN status ENUM('online', 'offline', 'playing', 'matching') DEFAULT 'offline';

-- 3. 添加对局的匹配模式字段
ALTER TABLE games ADD COLUMN match_mode ENUM('random', 'friend', 'normal', 'easy', 'hard') DEFAULT NULL AFTER game_type;

-- 4. 创建好友表（如果不存在）
CREATE TABLE IF NOT EXISTS friends (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL COMMENT '用户ID',
  friend_id INT NOT NULL COMMENT '好友ID',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  UNIQUE KEY unique_friendship (user_id, friend_id),
  INDEX idx_user_id (user_id),
  INDEX idx_friend_id (friend_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='好友关系表';

-- 5. 创建好友请求表（如果不存在）
CREATE TABLE IF NOT EXISTS friend_requests (
  id INT PRIMARY KEY AUTO_INCREMENT,
  from_user_id INT NOT NULL COMMENT '发送请求的用户ID',
  to_user_id INT NOT NULL COMMENT '接收请求的用户ID',
  status ENUM('pending', 'accepted', 'rejected') DEFAULT 'pending' COMMENT '请求状态',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  UNIQUE KEY unique_request (from_user_id, to_user_id),
  INDEX idx_to_user (to_user_id),
  INDEX idx_status (status),
  FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='好友请求表';

-- 6. 添加 last_login 字段（如果不存在）
-- 注意：如果字段已存在，此命令可能报错，可以忽略
ALTER TABLE users ADD COLUMN last_login TIMESTAMP NULL COMMENT '最后登录时间' AFTER status;

-- 迁移完成提示
SELECT '数据库迁移完成！' as message;

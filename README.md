 # 围棋在线对战平台

 一个支持人机对弈和人人对战的在线围棋平台，基于 React + Node.js 构建。

 ## 功能特性

 - **人机对弈 (PVE)** — 接入 DeepSeek 大模型作为 AI 对手
 - **人人对战 (PVP)** — 实时匹配，通过 WebSocket 进行对局
 - **棋谱回放** — 查看历史对局的逐步回放
 - **排行榜** — 玩家胜率与积分排名
 - **好友系统** — 添加好友、查看在线状态
 - **用户系统** — 注册、登录、个人资料与头像上传

 ## 技术栈

 ### 前端

 | 技术 | 说明 |
 |------|------|
 | React 18 | UI 框架 |
 | Vite 5 | 构建工具 |
 | React Router 6 | 路由管理 |
 | Zustand | 状态管理 |
 | Tailwind CSS 3 | 样式框架 |
 | Socket.io Client | WebSocket 通信 |
 | Axios | HTTP 请求 |

 ### 后端

 | 技术 | 说明 |
 |------|------|
 | Express 4 | Web 框架 |
 | Socket.io 4 | WebSocket 服务 |
 | SQLite (sql.js) / MySQL | 数据库 |
 | JWT | 身份认证 |
 | Multer | 文件上传 |
 | DeepSeek API | AI 对弈 |

 ## 项目结构

 ```
 系统培养作业/
 ├── client/                 # React 前端
 │   ├── src/
 │   │   ├── components/     # 公共组件 (棋盘、布局)
 │   │   ├── pages/          # 页面组件
 │   │   ├── services/       # API 和 Socket 服务
 │   │   ├── store/          # Zustand 状态管理
 │   │   └── utils/          # AI 对弈逻辑
 │   └── ...
 ├── server/                 # Express 后端
 │   ├── src/
 │   │   ├── config/         # 数据库配置
 │   │   ├── middleware/     # JWT 认证中间件
 │   │   ├── routes/         # API 路由
 │   │   ├── socket/         # WebSocket 事件处理
 │   │   └── scripts/        # 数据库初始化脚本
 │   └── ...
 └── README.md
 ```

 ## 快速开始

 ### 环境要求

 - Node.js >= 18
 - npm >= 9

 ### 1. 安装依赖

 ```bash
 # 后端
 cd server
 npm install

 # 前端
 cd ../client
 npm install
 ```

 ### 2. 配置环境变量

 ```bash
 cd server
 cp .env.example .env
 ```

 编辑 `.env` 文件，填入实际配置：

 ```env
 PORT=3000
 NODE_ENV=development

 # 数据库 (默认使用 SQLite，无需额外配置)
 DB_HOST=localhost
 DB_PORT=3306
 DB_USER=root
 DB_PASSWORD=your_password
 DB_NAME=go_game

 # JWT
 JWT_SECRET=your_jwt_secret_key_here
 JWT_EXPIRES_IN=7d

 # 前端地址
 CLIENT_URL=http://localhost:5173

 # AI 对弈 (DeepSeek)
 ANTHROPIC_API_KEY=your_api_key_here
 ANTHROPIC_API_URL=https://api.deepseek.com/v1/chat/completions
 ANTHROPIC_MODEL=deepseek-chat
 ```

 ### 3. 初始化数据库

 ```bash
 cd server
 npm run init-db
 ```

 ### 4. 启动项目

 ```bash
 # 启动后端 (端口 3000)
 cd server
 npm run dev

 # 启动前端 (端口 5173)
 cd client
 npm run dev
 ```

 浏览器访问 `http://localhost:5173` 即可使用。

 ## 生产部署

 ```bash
 # 构建前端
 cd client
 npm run build

 # 生产环境启动后端 (同时托管前端静态文件)
 cd ../server
 npm run start:prod
 ```

 ## API 概览

 | 路由 | 说明 |
 |------|------|
 | `/api/auth` | 注册、登录 |
 | `/api/user` | 用户信息、头像上传 |
 | `/api/game` | 游戏记录 CRUD |
 | `/api/rank` | 排行榜 |
 | `/api/friend` | 好友管理 |
 | `/api/llm` | AI 对弈接口 |
 | `/api/health` | 健康检查 |

 ## 许可

 MIT

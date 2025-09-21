# CAPCHA
这是一个使用JavaScript实现的完整验证码系统，包含前后端功能。后端负责生成四位验证码（符号、文字与数字的组合），使用Canvas渲染后发送给前端，前端负责接收用户输入、显示验证码图片并提交验证。整个系统使用AES加密保护验证码信息的安全传输。

## 技术栈

- **后端**: Node.js, Express, Canvas
- **前端**: HTML, CSS, JavaScript
- **加密**: AES加密 (CryptoJS)

## 功能特点

- 生成包含字母、数字和符号的四位验证码
- 使用Canvas渲染验证码图片，包含干扰线和干扰点
- 验证码图片中的字符随机旋转，提高安全性
- AES加密保护验证码ID的传输
- 验证码5分钟内有效
- 前端支持刷新验证码、提交验证等功能

## 快速开始

### 安装依赖

```bash
npm install
```

### 启动服务器

```bash
npm start
# 或使用开发模式（自动重启）
npm run dev
```

### 访问系统

打开浏览器，访问 [http://localhost:3000](http://localhost:3000)

## 安全注意事项

- 在实际生产环境中，请将加密密钥（SECRET_KEY和SECRET_IV）存储在环境变量中，而不是直接硬编码在代码里
- 可以考虑使用Session或Redis存储验证码，而不是内存中的Map
- 根据实际需求调整验证码的复杂度、有效期等参数

## 项目结构

```
CAPCHA/
├── server.js         # 后端主文件
├── package.json      # 项目配置和依赖
├── .gitignore        # Git忽略文件配置
├── public/           # 前端文件目录
│   ├── index.html    # 前端主页面
│   └── app.js        # 前端JavaScript代码
└── README.md         # 项目说明文档
```

## API接口说明

### 获取验证码

- **URL**: `/api/captcha`
- **方法**: `GET`
- **响应**: PNG图片数据，在响应头X-Captcha-Id中包含加密的验证码ID

### 验证验证码

- **URL**: `/api/verify-captcha`
- **方法**: `POST`
- **请求体**: `{"captchaId": "加密的验证码ID", "userInput": "用户输入的验证码"}`
- **响应**: `{"success": true/false, "message": "提示消息"}`

## License

MIT License

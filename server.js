// 导入所需模块
const express = require('express');
const cors = require('cors');
const CryptoJS = require('crypto-js');
const svgCaptcha = require('svg-captcha');

// 创建Express应用
const app = express();
const PORT = 3000;

// 配置文件
const config = {
  // 验证成功后的跳转URL（可选，如果为空则返回JSON响应）
  redirectUrl: 'success.html', // 可以设置为具体的HTML文件路径，如 'success.html' 或 'https://example.com'
  // 是否启用跳转功能
  enableRedirect: true
};

// 中间件配置
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// AES加密配置
const SECRET_KEY = 'YourSecretKeyForEncryption'; // 实际应用中应从环境变量中获取
const SECRET_IV = 'YourInitializationVector';
const key = CryptoJS.enc.Utf8.parse(SECRET_KEY);
const iv = CryptoJS.enc.Utf8.parse(SECRET_IV);

// 存储生成的验证码（实际应用中可以使用session或Redis）
const captchaStore = new Map();

// 存储用户错误次数和锁定状态（使用浏览器指纹作为key）
const fingerprintStore = new Map();

// 锁定配置
const LOCK_CONFIG = {
  maxAttempts: 3, // 最大尝试次数
  lockDuration: 30 * 1000, // 锁定时间（30秒）
  cleanupInterval: 60 * 1000 // 清理过期记录的间隔（60秒）
};

/**
 * 加密函数
 * @param {string} data - 要加密的数据
 * @returns {string} 加密后的字符串
 */
function encryptData(data) {
  try {
    // 使用字符串密钥直接加密，让CryptoJS处理内部转换
    const encrypted = CryptoJS.AES.encrypt(data, SECRET_KEY, {
      iv: SECRET_IV,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7
    });
    
    const result = encrypted.toString();
    console.log('加密成功，原文长度:', data.length, '加密后长度:', result.length);
    return result;
  } catch (error) {
    console.error('加密失败:', error);
    throw error;
  }
}

/**
 * 解密函数
 * @param {string} encryptedData - 加密的数据
 * @returns {string} 解密后的字符串
 */
function decryptData(encryptedData) {
  try {
    // 检查输入是否为空或格式不正确
    if (!encryptedData || typeof encryptedData !== 'string') {
      throw new Error('加密数据为空或格式不正确');
    }
    
    console.log('解密前的encryptedData:', encryptedData.substring(0, 20) + '...');
    console.log('解密前的encryptedData长度:', encryptedData.length);
    
    // 使用字符串密钥直接解密，让CryptoJS处理内部转换
    const decrypted = CryptoJS.AES.decrypt(encryptedData, SECRET_KEY, {
      iv: SECRET_IV,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7
    });
    
    // 尝试转换为UTF-8字符串
    const result = decrypted.toString(CryptoJS.enc.Utf8);
    
    console.log('解密结果:', result || '空');
    
    // 检查解密结果是否有效
    if (!result) {
      throw new Error('解密结果为空，可能是密钥不匹配或数据已损坏');
    }
    
    return result;
  } catch (error) {
    console.error('解密失败:', error.message);
    // 解密失败时返回特定标记，便于上层处理
    return null;
  }
}

/**
 * 检查指纹是否被锁定
 * @param {string} fingerprint - 浏览器指纹
 * @returns {Object} 锁定状态信息
 */
function checkFingerprintLock(fingerprint) {
  const record = fingerprintStore.get(fingerprint);
  
  if (!record) {
    return { locked: false, attemptsLeft: LOCK_CONFIG.maxAttempts };
  }
  
  const now = Date.now();
  
  // 检查是否处于锁定状态
  if (record.lockedUntil && now < record.lockedUntil) {
    const timeLeft = Math.ceil((record.lockedUntil - now) / 1000);
    return { 
      locked: true, 
      timeLeft: timeLeft,
      message: `您的访问已被锁定，请${timeLeft}秒后再试`
    };
  }
  
  // 如果锁定时间已过，解锁并清除记录
  if (record.lockedUntil && now >= record.lockedUntil) {
    fingerprintStore.delete(fingerprint);
    return { locked: false, attemptsLeft: LOCK_CONFIG.maxAttempts };
  }
  
  // 返回剩余尝试次数
  const attemptsLeft = LOCK_CONFIG.maxAttempts - (record.errorCount || 0);
  return { locked: false, attemptsLeft: Math.max(0, attemptsLeft) };
}

/**
 * 记录错误尝试
 * @param {string} fingerprint - 浏览器指纹
 * @returns {Object} 处理结果
 */
function recordErrorAttempt(fingerprint) {
  const record = fingerprintStore.get(fingerprint) || { errorCount: 0, firstErrorTime: Date.now() };
  
  record.errorCount = (record.errorCount || 0) + 1;
  record.lastErrorTime = Date.now();
  
  if (record.errorCount >= LOCK_CONFIG.maxAttempts) {
    // 达到最大错误次数，锁定用户
    record.lockedUntil = Date.now() + LOCK_CONFIG.lockDuration;
    record.lockStartTime = Date.now();
    
    fingerprintStore.set(fingerprint, record);
    
    return {
      locked: true,
      timeLeft: Math.ceil(LOCK_CONFIG.lockDuration / 1000),
      message: `连续${LOCK_CONFIG.maxAttempts}次验证失败，您的访问已被锁定30秒`
    };
  } else {
    // 未达到锁定条件，更新记录
    fingerprintStore.set(fingerprint, record);
    
    return {
      locked: false,
      attemptsLeft: LOCK_CONFIG.maxAttempts - record.errorCount,
      message: `验证码不正确，还有${LOCK_CONFIG.maxAttempts - record.errorCount}次机会`
    };
  }
}

/**
 * 清理过期的指纹记录
 */
function cleanupFingerprintRecords() {
  const now = Date.now();
  let cleanedCount = 0;
  
  for (let [fingerprint, record] of fingerprintStore.entries()) {
    // 如果锁定已过期，删除记录
    if (record.lockedUntil && now >= record.lockedUntil) {
      fingerprintStore.delete(fingerprint);
      cleanedCount++;
      continue;
    }
    
    // 如果错误记录超过1小时，删除记录
    if (record.lastErrorTime && (now - record.lastErrorTime) > 60 * 60 * 1000) {
      fingerprintStore.delete(fingerprint);
      cleanedCount++;
    }
  }
  
  if (cleanedCount > 0) {
    console.log(`清理了${cleanedCount}条过期的指纹记录`);
  }
}

/**
 * 生成验证码（使用svg-captcha）
 * @returns {Object} 包含验证码文本和SVG数据的对象
 */
function generateCaptcha() {
  // 配置验证码选项：四位字符，包含字母、数字和特殊符号
  const options = {
    size: 4,
    ignoreChars: '', // 不忽略任何字符
    noise: 3, // 干扰线数量
    width: 200,
    height: 80,
    color: true, // 彩色文字
    background: '#f5f5f5',
    fontSize: 40,
    charPreset: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()'
  };
  
  // 生成验证码
  const captcha = svgCaptcha.create(options);
  
  return {
    text: captcha.text,
    svg: captcha.data
  };
}

// API路由：获取验证码图片和加密后的ID
app.get('/api/captcha', (req, res) => {
  try {
    // 获取浏览器指纹
    const fingerprint = req.headers['x-browser-fingerprint'];
    
    if (!fingerprint) {
      return res.status(400).json({ 
        success: false, 
        message: '缺少浏览器指纹，请刷新页面重试' 
      });
    }
    
    // 检查指纹是否被锁定
    const lockStatus = checkFingerprintLock(fingerprint);
    
    if (lockStatus.locked) {
      return res.status(403).json({ 
        success: false, 
        message: lockStatus.message,
        locked: true,
        timeLeft: lockStatus.timeLeft
      });
    }
    
    // 生成验证码
    const captcha = generateCaptcha();
    
    // 生成唯一ID
    const captchaId = Date.now().toString() + Math.random().toString(36).substr(2);
    
    // 存储验证码文本和ID，设置5分钟过期
    captchaStore.set(captchaId, { text: captcha.text, timestamp: Date.now() });
    
    // 加密ID
    const encryptedId = encryptData(captchaId);
    
    // 返回JSON格式的响应，包含SVG图片和加密的ID
    res.json({
      success: true,
      svg: captcha.svg,
      captchaId: encryptedId,
      attemptsLeft: lockStatus.attemptsLeft
    });
  } catch (error) {
    console.error('生成验证码失败:', error);
    res.status(500).json({ success: false, message: '生成验证码失败' });
  }
});

// API路由：验证验证码
app.post('/api/verify-captcha', (req, res) => {
  try {
    const { captchaId, userInput } = req.body;
    
    // 获取浏览器指纹
    const fingerprint = req.headers['x-browser-fingerprint'];
    
    if (!fingerprint) {
      return res.status(400).json({ 
        success: false, 
        message: '缺少浏览器指纹，请刷新页面重试' 
      });
    }
    
    console.log('接收到验证请求:', { 
      captchaIdLength: captchaId?.length, 
      userInput, 
      fingerprint: fingerprint.substring(0, 8) + '...' 
    });
    
    // 检查指纹是否被锁定
    const lockStatus = checkFingerprintLock(fingerprint);
    
    if (lockStatus.locked) {
      return res.status(403).json({ 
        success: false, 
        message: lockStatus.message,
        locked: true,
        timeLeft: lockStatus.timeLeft
      });
    }
    
    // 验证参数
    if (!captchaId || !userInput) {
      console.log('验证码ID或输入为空');
      return res.json({ success: false, message: '验证码ID或输入不能为空' });
    }
    
    // 解密ID
    console.log('尝试解密验证码ID，长度:', captchaId.length);
    const decryptedId = decryptData(captchaId);
    
    // 检查解密结果
    if (!decryptedId) {
      console.log('解密失败，captchaId:', captchaId.substring(0, 20) + '...');
      return res.json({ success: false, message: '验证码ID无效或已过期' });
    }
    
    console.log('解密成功，decryptedId:', decryptedId);
    
    // 获取存储的验证码
    const storedCaptcha = captchaStore.get(decryptedId);
    
    // 验证验证码是否存在且未过期
    if (!storedCaptcha) {
      console.log('未找到存储的验证码:', decryptedId);
      return res.json({ success: false, message: '验证码不存在或已过期' });
    }
    
    // 检查是否超过5分钟有效期
    if (Date.now() - storedCaptcha.timestamp > 5 * 60 * 1000) {
      captchaStore.delete(decryptedId);
      console.log('验证码已过期:', decryptedId);
      return res.json({ success: false, message: '验证码已过期' });
    }
    
    // 验证用户输入是否正确（不区分大小写）
    const isMatch = userInput.toLowerCase() === storedCaptcha.text.toLowerCase();
    
    // 无论验证成功与否，都删除已使用的验证码
    captchaStore.delete(decryptedId);
    
    if (isMatch) {
      console.log('验证码验证成功:', decryptedId);
      
      // 验证成功，清除该指纹的错误记录
      if (fingerprintStore.has(fingerprint)) {
        fingerprintStore.delete(fingerprint);
        console.log('验证成功，清除指纹记录:', fingerprint.substring(0, 8) + '...');
      }
      
      // 构建响应数据
      const responseData = { 
        success: true, 
        message: '验证码验证成功',
        redirectUrl: null
      };
      
      // 如果启用了跳转功能且设置了跳转URL，则添加到响应中
      if (config.enableRedirect && config.redirectUrl) {
        responseData.redirectUrl = config.redirectUrl;
        console.log('验证成功，将跳转到:', config.redirectUrl);
      }
      
      res.json(responseData);
    } else {
      console.log('验证码不正确:', { userInput, expected: storedCaptcha.text });
      
      // 记录错误尝试
      const errorResult = recordErrorAttempt(fingerprint);
      console.log('记录错误尝试:', errorResult);
      
      res.json({ 
        success: false, 
        message: errorResult.message,
        locked: errorResult.locked,
        timeLeft: errorResult.timeLeft || 0,
        attemptsLeft: errorResult.attemptsLeft
      });
    }
  } catch (error) {
    console.error('验证验证码失败:', error);
    res.status(500).json({ success: false, message: '验证验证码失败' });
  }
});

// 清理过期的指纹记录（每60秒执行一次）
setInterval(() => {
  cleanupFingerprintRecords();
}, LOCK_CONFIG.cleanupInterval);

// 清理过期的验证码（每30秒执行一次）
setInterval(() => {
  const now = Date.now();
  const expireTime = 5 * 60 * 1000; // 5分钟 (300,000毫秒)
  const expiredCount = 0;
  
  console.log(`清理前验证码数量: ${captchaStore.size}`);
  console.log(`当前时间: ${new Date().toISOString()}`);
  
  for (let [id, captcha] of captchaStore.entries()) {
    const age = now - captcha.timestamp;
    console.log(`验证码 ${id} 已存在: ${Math.floor(age/1000)}秒 (过期时间: ${Math.floor(expireTime/1000)}秒)`);
    if (age > expireTime) {
      captchaStore.delete(id);
      console.log(`已删除过期验证码: ${id}`);
    }
  }
  
  console.log(`清理后验证码数量: ${captchaStore.size}`);
}, 30000);

// 启动服务器
app.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
  console.log('验证码系统已启动');
});
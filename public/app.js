// 当前验证码ID（加密后的）
let currentCaptchaId = null;

// 浏览器指纹
let browserFingerprint = null;

// 指纹存储键名
const FINGERPRINT_STORAGE_KEY = 'captcha_fingerprint';

/**
 * 获取或生成浏览器指纹
 * 优先从本地存储获取，如果不存在则生成并存储
 * @returns {string} 浏览器指纹
 */
function getOrCreateFingerprint() {
  try {
    // 首先尝试从本地存储获取指纹
    const storedFingerprint = localStorage.getItem(FINGERPRINT_STORAGE_KEY);
    if (storedFingerprint) {
      console.log('使用存储的指纹:', storedFingerprint);
      return storedFingerprint;
    }
    
    // 如果没有存储的指纹，生成新的指纹
    const newFingerprint = generateBrowserFingerprint();
    
    // 存储指纹到本地存储
    localStorage.setItem(FINGERPRINT_STORAGE_KEY, newFingerprint);
    console.log('生成并存储新指纹:', newFingerprint);
    
    return newFingerprint;
  } catch (error) {
    console.error('获取指纹失败，使用默认指纹:', error);
    // 如果本地存储不可用，直接生成指纹但不存储
    return generateBrowserFingerprint();
  }
}

/**
 * 生成浏览器指纹
 * 基于用户代理、屏幕信息、时区等信息生成唯一标识
 * 使用更稳定的算法，确保同一浏览器生成的指纹一致
 * @returns {string} 浏览器指纹
 */
function generateBrowserFingerprint() {
  try {
    // 收集浏览器信息 - 使用更稳定的特征
    const screenInfo = {
      width: screen.width,
      height: screen.height,
      availWidth: screen.availWidth,
      availHeight: screen.availHeight,
      colorDepth: screen.colorDepth,
      pixelDepth: screen.pixelDepth
    };
    
    const navigatorInfo = {
      userAgent: navigator.userAgent,
      language: navigator.language,
      languages: navigator.languages ? navigator.languages.join(',') : navigator.language,
      platform: navigator.platform,
      cookieEnabled: navigator.cookieEnabled,
      doNotTrack: navigator.doNotTrack,
      hardwareConcurrency: navigator.hardwareConcurrency || 0,
      maxTouchPoints: navigator.maxTouchPoints || 0
    };
    
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || new Date().getTimezoneOffset();
    
    // 生成更稳定的canvas指纹
    let canvasFingerprint = '';
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      // 使用固定的绘制参数，确保同一浏览器生成相同结果
      canvas.width = 200;
      canvas.height = 50;
      
      ctx.textBaseline = 'top';
      ctx.font = '14px Arial';
      ctx.fillStyle = '#f60';
      ctx.fillRect(10, 10, 60, 20);
      ctx.fillStyle = '#069';
      ctx.fillText('Fingerprint', 15, 15);
      ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
      ctx.fillText(navigator.userAgent.substring(0, 30), 5, 35);
      
      // 获取图像数据的前100个像素作为指纹
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const pixelData = [];
      for (let i = 0; i < Math.min(100, imageData.data.length); i += 4) {
        pixelData.push(imageData.data[i] + imageData.data[i + 1] + imageData.data[i + 2]);
      }
      canvasFingerprint = pixelData.join(',');
    } catch (e) {
      canvasFingerprint = 'canvas-not-supported-' + navigator.userAgent.length;
    }
    
    // 添加WebGL指纹（如果支持）
    let webglFingerprint = '';
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (gl) {
        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        if (debugInfo) {
          webglFingerprint = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) + '|' + 
                           gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
        }
      }
    } catch (e) {
      webglFingerprint = 'webgl-not-supported';
    }
    
    // 音频指纹
    let audioFingerprint = '';
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const analyser = audioContext.createAnalyser();
      const gainNode = audioContext.createGain();
      
      oscillator.type = 'triangle';
      oscillator.frequency.setValueAtTime(10000, audioContext.currentTime);
      
      gainNode.gain.setValueAtTime(0, audioContext.currentTime);
      oscillator.connect(analyser);
      analyser.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.start(0);
      
      const frequencyData = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(frequencyData);
      
      let sum = 0;
      for (let i = 0; i < frequencyData.length; i++) {
        sum += frequencyData[i];
      }
      audioFingerprint = sum.toString();
      
      oscillator.stop();
      audioContext.close();
    } catch (e) {
      audioFingerprint = 'audio-not-supported';
    }
    
    // 组合所有信息 - 移除时间相关数据，确保稳定性
    const combinedString = JSON.stringify({
      screen: screenInfo,
      navigator: navigatorInfo,
      timezone: timezone,
      canvas: canvasFingerprint,
      webgl: webglFingerprint,
      audio: audioFingerprint,
      // 添加一些硬件特征
      memory: navigator.deviceMemory || 0,
      connection: navigator.connection ? navigator.connection.effectiveType : 'unknown'
    });
    
    // 使用更稳定的哈希函数
    function stableHash(str) {
      let hash = 0;
      if (str.length === 0) return hash;
      for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // 转换为32位整数
      }
      return Math.abs(hash).toString(16);
    }
    
    // 生成稳定的指纹 - 不包含时间戳，确保同一浏览器始终生成相同指纹
    return stableHash(combinedString) + '-' + 
           stableHash(navigator.userAgent).substring(0, 8) + '-' + 
           stableHash(screen.width + 'x' + screen.height).substring(0, 6);
  } catch (error) {
    console.error('生成浏览器指纹失败:', error);
    // 如果生成失败，返回一个基于用户代理的稳定指纹
    const userAgentHash = function(str) {
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash = hash & hash;
      }
      return Math.abs(hash).toString(16);
    }(navigator.userAgent);
    
    return 'fallback-' + userAgentHash.substring(0, 12) + '-' + 
           Math.abs(navigator.userAgent.length * screen.width * screen.height).toString(16).substring(0, 6);
  }
}

// AES加密配置（与后端保持一致）
const SECRET_KEY = 'YourSecretKeyForEncryption';
const SECRET_IV = 'YourInitializationVector';

// 注意：不再使用预处理的密钥和IV，直接使用字符串形式

// DOM元素
const captchaImage = document.getElementById('captcha-image');
const refreshBtn = document.getElementById('refresh-btn');
const captchaInput = document.getElementById('captcha-input');
const submitBtn = document.getElementById('submit-btn');
const resultMessage = document.getElementById('result-message');
const loading = document.getElementById('loading');
const captchaSection = document.getElementById('captcha-section');

/**
 * 加密函数
 * @param {string} data - 要加密的数据
 * @returns {string} 加密后的字符串
 */
function encryptData(data) {
  const encrypted = CryptoJS.AES.encrypt(data, SECRET_KEY, {
    iv: SECRET_IV,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7
  });
  return encrypted.toString();
}

/**
 * 解密函数
 * @param {string} encryptedData - 加密的数据
 * @returns {string} 解密后的字符串
 */
function decryptData(encryptedData) {
  const decrypted = CryptoJS.AES.decrypt(encryptedData, SECRET_KEY, {
    iv: SECRET_IV,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7
  });
  return decrypted.toString(CryptoJS.enc.Utf8);
}

/**
 * 获取验证码图片
 */
function fetchCaptcha() {
  // 显示加载状态
  loading.style.display = 'block';
  captchaSection.style.display = 'none';
  resultMessage.className = 'message';
  resultMessage.style.display = 'none';
  
  // 如果还没有生成指纹，先生成
  if (!browserFingerprint) {
    browserFingerprint = getOrCreateFingerprint();
    console.log('使用指纹获取验证码:', browserFingerprint);
  }
  
  // 添加随机参数避免缓存
  const timestamp = new Date().getTime();
  
  // 使用fetch API获取验证码数据，并带上指纹
  fetch(`/api/captcha?t=${timestamp}`, {
    headers: {
      'X-Browser-Fingerprint': browserFingerprint
    }
  })
    .then(response => {
      if (!response.ok) {
        throw new Error(`HTTP错误! 状态码: ${response.status}`);
      }
      return response.json();
    })
    .then(data => {
      if (data.success && data.svg && data.captchaId) {
        // 存储加密的验证码ID
        currentCaptchaId = data.captchaId;
        
        console.log('前端接收到的captchaId:', currentCaptchaId);
        console.log('captchaId长度:', currentCaptchaId.length);
        console.log('剩余尝试次数:', data.attemptsLeft);
        
        // 创建SVG图片URL
        const svgText = data.svg;
        const blob = new Blob([svgText], {type: 'image/svg+xml'});
        const imageUrl = URL.createObjectURL(blob);
        
        // 设置图片源
        captchaImage.onload = function() {
          // 图片加载完成后显示
          loading.style.display = 'none';
          captchaSection.style.display = 'block';
          // 释放URL对象
          URL.revokeObjectURL(imageUrl);
          
          // 前端解密测试（仅用于调试）
          try {
            const testDecrypted = decryptData(currentCaptchaId);
            console.log('前端解密测试结果:', testDecrypted || '解密失败');
          } catch (e) {
            console.error('前端解密测试失败:', e);
          }
        };
        captchaImage.src = imageUrl;
      } else if (data.locked) {
        // 显示锁定信息
        loading.style.display = 'none';
        captchaSection.style.display = 'none';
        showMessage(data.message, false);
        
        // 显示倒计时
        let timeLeft = data.timeLeft;
        const countdownInterval = setInterval(() => {
          timeLeft--;
          if (timeLeft <= 0) {
            clearInterval(countdownInterval);
            showMessage('', false);
            fetchCaptcha(); // 重新尝试获取验证码
          } else {
            showMessage(`${data.message} (${timeLeft}秒后自动解锁)`, false);
          }
        }, 1000);
      } else {
        showMessage('获取验证码失败：' + (data.message || '未知错误'), false);
        loading.style.display = 'none';
      }
    })
    .catch(error => {
      showMessage('获取验证码失败：网络错误', false);
      loading.style.display = 'none';
      console.error('获取验证码失败:', error);
    });
}

/**
 * 提交验证码验证
 */
function submitCaptcha() {
  const userInput = captchaInput.value.trim();
  
  // 验证输入
  if (!userInput) {
    showMessage('请输入验证码', false);
    return;
  }
  
  if (!currentCaptchaId) {
    showMessage('请先获取验证码', false);
    return;
  }
  
  // 获取或生成浏览器指纹（如果还没有生成）
  if (!browserFingerprint) {
    browserFingerprint = getOrCreateFingerprint();
    console.log('使用指纹提交验证码:', browserFingerprint);
  }
  
  console.log('提交验证时的captchaId:', currentCaptchaId);
  console.log('提交验证时的captchaId长度:', currentCaptchaId.length);
  console.log('使用指纹:', browserFingerprint.substring(0, 8) + '...');
  
  // 显示加载状态
  submitBtn.disabled = true;
  submitBtn.textContent = '验证中...';
  resultMessage.className = 'message';
  resultMessage.style.display = 'none';
  
  // 创建请求数据
  const requestData = {
    captchaId: currentCaptchaId,
    userInput: userInput
  };
  
  // 发送验证请求
  fetch('/api/verify-captcha', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Browser-Fingerprint': browserFingerprint
    },
    body: JSON.stringify(requestData)
  })
    .then(response => response.json())
    .then(data => {
      // 恢复按钮状态
      submitBtn.disabled = false;
      submitBtn.textContent = '验证';
      
      // 显示结果消息
      showMessage(data.message, data.success);
      
      // 处理验证结果
      if (data.success) {
        // 清空输入框
        captchaInput.value = '';
        
        // 检查后端是否返回了跳转URL
        if (data.redirectUrl) {
          // 如果有跳转URL，则执行跳转
          console.log('验证码验证成功，正在跳转到:', data.redirectUrl);
          window.location.href = data.redirectUrl;
        } else {
          // 如果没有跳转URL，则5秒后刷新验证码
          console.log('验证码验证成功，5秒后刷新验证码');
          setTimeout(fetchCaptcha, 5000);
        }
      } else if (data.locked) {
        // 如果被锁定，显示倒计时
        console.log('用户被锁定，显示倒计时');
        
        let timeLeft = data.timeLeft;
        const countdownInterval = setInterval(() => {
          timeLeft--;
          if (timeLeft <= 0) {
            clearInterval(countdownInterval);
            showMessage('', false);
            fetchCaptcha(); // 重新尝试获取验证码
          } else {
            showMessage(`${data.message} (${timeLeft}秒后自动解锁)`, false);
          }
        }, 1000);
      } else if (data.message.includes('不正确')) {
        // 如果验证码不正确，立即刷新验证码
        console.log('验证码不正确，立即刷新');
        
        // 短暂延迟后刷新验证码，让用户能看到错误提示
        setTimeout(() => {
          captchaInput.value = '';
          fetchCaptcha();
        }, 1000);
      }
    })
    .catch(error => {
      // 恢复按钮状态
      submitBtn.disabled = false;
      submitBtn.textContent = '验证';
      
      showMessage('验证失败：网络错误', false);
      console.error('验证失败:', error);
    });
}

/**
 * 显示消息
 * @param {string} text - 消息文本
 * @param {boolean} isSuccess - 是否为成功消息
 */
function showMessage(text, isSuccess) {
  resultMessage.textContent = text;
  resultMessage.className = 'message ' + (isSuccess ? 'success' : 'error');
  resultMessage.style.display = 'block';
}

// 事件监听器
captchaImage.addEventListener('click', fetchCaptcha);
refreshBtn.addEventListener('click', fetchCaptcha);
submitBtn.addEventListener('click', submitCaptcha);

// 按Enter键提交
captchaInput.addEventListener('keypress', function(event) {
  if (event.key === 'Enter') {
    submitCaptcha();
  }
});

// 页面加载时获取验证码
window.addEventListener('load', fetchCaptcha);
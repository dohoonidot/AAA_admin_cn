const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const fs = require('fs');
const https = require('https');

// 데이터베이스 연결 - db.js에서 이미 dotenv를 로드함
const db = require('./config/db');
console.log('데이터베이스 모듈 로드됨');

// 이미지 디렉토리 확인 및 생성
const imageDir = path.join(__dirname, '../client/images');
if (!fs.existsSync(imageDir)) {
  console.log('이미지 디렉토리 생성:', imageDir);
  fs.mkdirSync(imageDir, { recursive: true });
}

const app = express();
// PORT: nodemon(dev)이 PORT=3000 주입 → 로컬 3000 / 서버 .env PORT=9999
const PORT = process.env.PORT || 9999;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const UPSTREAM_HOST = process.env.UPSTREAM_HOST || 'localhost';
const UPSTREAM_PORT = Number(process.env.UPSTREAM_PORT || 8060);

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// 라우트 모듈 로드
const healthRoutes = require('./routes/health.routes');
const userRoutes = require('./routes/user.routes');
const conversationRoutes = require('./routes/conversation.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const mainRoutes = require('./routes/main.routes');
const giftsRoutes = require('./routes/gifts.routes');

// 요청 로깅 미들웨어 (디버깅용) - 모든 요청에 대해
app.use((req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/admin')) {
    console.log(`🔵 [미들웨어] === API 요청 ===`);
    console.log(`🔵 [미들웨어] ${req.method} ${req.path}`);
    console.log('🔵 [미들웨어] 전체 URL:', req.originalUrl);
    console.log('🔵 [미들웨어] 전체 경로:', req.url);
    console.log('🔵 [미들웨어] 원본 URL:', req.originalUrl);
    console.log('🔵 [미들웨어] 요청 헤더 Content-Type:', req.headers['content-type']);
  }
  next();
});

// 라우트 등록
app.use('/api/health', healthRoutes);
app.use('/api/users', userRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/main', mainRoutes);
app.use('/api/gifts', giftsRoutes);

// Proxy: 로그인 API (CORS 회피를 위한 프록시)
app.post('/admin/login', (req, res) => {
  try {
    console.log('=== 로그인 API 요청 ===');
    console.log('요청 본문:', { ...req.body, password: '****' });
    
    const { user_id, password } = req.body || {};
    
    if (!user_id || !password) {
      console.log('필수 파라미터 누락:', { user_id: !!user_id, password: !!password });
      return res.status(400).json({ 
        status_code: 400, 
        error: 'user_id and password are required' 
      });
    }

    const payload = JSON.stringify({ user_id, password });
    console.log('외부 API 호출 페이로드:', { user_id, password: '****' });

    const options = {
      hostname: UPSTREAM_HOST,
      port: UPSTREAM_PORT,
      path: '/admin/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 10000
    };

    console.log('외부 API 옵션:', options);

    const proxyReq = https.request(options, (proxyRes) => {
      console.log('외부 API 응답 상태:', proxyRes.statusCode);
      let data = '';
      
      proxyRes.on('data', (chunk) => { 
        data += chunk; 
      });
      
      proxyRes.on('end', () => {
        console.log('외부 API 응답 완료:', data);
        const status = proxyRes.statusCode || 500;
        try {
          const json = data ? JSON.parse(data) : {};
          console.log('파싱된 응답:', json);
          return res.status(status).json(json);
        } catch (e) {
          console.error('JSON 파싱 오류:', e);
          return res.status(status).send(data);
        }
      });
    });

    proxyReq.on('error', (err) => {
      console.error('로그인 proxy error:', err.message);
      console.error('에러 상세:', err);
      return res.status(502).json({ 
        status_code: 502, 
        error: `Upstream request failed: ${err.message}` 
      });
    });

    proxyReq.on('timeout', () => {
      console.error('외부 API 타임아웃');
      proxyReq.destroy();
      return res.status(504).json({ 
        status_code: 504, 
        error: 'Request timeout' 
      });
    });

    proxyReq.write(payload);
    proxyReq.end();
  } catch (error) {
    console.error('로그인 proxy handler error:', error);
    return res.status(500).json({ 
      status_code: 500, 
      error: `Internal server error: ${error.message}` 
    });
  }
});

// Proxy: 대리승인/반려 API (가장 먼저 등록)
app.post('/admin/leave/approval', async (req, res) => {
  console.log('🔵 [라우트 핸들러] 대리승인/반려 API 라우트 호출됨');
  console.log('🔵 [라우트 핸들러] 요청 경로:', req.path);
  console.log('🔵 [라우트 핸들러] 요청 URL:', req.url);
  const maxRetries = 3;
  let retryCount = 0;

  const makeRequest = async () => {
    try {
      console.log('=== 대리승인/반려 API 요청 ===');
      console.log('📥 [요청 수신] 원본 req.body:', JSON.stringify(req.body, null, 2));
      console.log('📥 [요청 수신] req.body 타입:', typeof req.body);
      console.log('📥 [요청 수신] req.body 키:', Object.keys(req.body || {}));
      console.log(`재시도 횟수: ${retryCount}/${maxRetries}`);

      const { id, admin_id, user_id, status, reject_message } = req.body || {};

      console.log('📋 [파라미터 추출] id:', id, '(타입:', typeof id, ')');
      console.log('📋 [파라미터 추출] admin_id:', admin_id, '(타입:', typeof admin_id, ')');
      console.log('📋 [파라미터 추출] user_id:', user_id, '(타입:', typeof user_id, ')');
      console.log('📋 [파라미터 추출] status:', status, '(타입:', typeof status, ')');
      console.log('📋 [파라미터 추출] reject_message:', reject_message, '(타입:', typeof reject_message, ')');

      if (!id || !admin_id || !user_id || !status) {
        console.log('❌ 필수 파라미터 누락:', { id, admin_id, user_id, status });
        return res.status(400).json({
          status_code: 400,
          error: 'id, admin_id, user_id, status are required'
        });
      }

      // status 값 검증
      const validStatuses = ['APPROVED', 'REJECTED', 'CANCELLED'];
      if (!validStatuses.includes(status)) {
        console.log('❌ 잘못된 status 값:', status);
        return res.status(400).json({
          status_code: 400,
          error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
        });
      }

      const payload = JSON.stringify({
        id,
        admin_id,
        user_id,
        status,
        reject_message: reject_message || ''
      });
      console.log('📤 [외부 API 전송] 페이로드:', payload);
      console.log('📤 [외부 API 전송] 페이로드 길이:', Buffer.byteLength(payload), 'bytes');

      const options = {
        hostname: UPSTREAM_HOST,
        port: UPSTREAM_PORT,
        path: '/admin/leave/approval',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'Connection': 'keep-alive',
          'User-Agent': 'Node.js Admin Panel'
        },
        timeout: 30000,
        keepAlive: true,
        keepAliveMsecs: 1000
      };

      console.log('외부 API 옵션:', options);

      return new Promise((resolve, reject) => {
        const proxyReq = https.request(options, (proxyRes) => {
          console.log('✅ 외부 API 응답 상태:', proxyRes.statusCode);
          console.log('✅ 응답 헤더:', proxyRes.headers);
          let data = '';

          proxyRes.on('data', (chunk) => {
            data += chunk;
            console.log('응답 데이터 청크:', chunk.toString());
          });

          proxyRes.on('end', () => {
            console.log('✅ 외부 API 응답 완료:', data);
            const status = proxyRes.statusCode || 500;
            
            // 에러 상태 코드 처리
            if (status >= 400) {
              console.error('❌ 외부 API 에러 응답:', {
                status,
                data,
                path: options.path
              });
            }
            
            try {
              const json = data ? JSON.parse(data) : {};
              console.log('파싱된 응답:', json);
              resolve({ status, json });
            } catch (e) {
              console.error('JSON 파싱 오류:', e);
              resolve({ status, data });
            }
          });
        });

        proxyReq.on('error', (err) => {
          console.error('❌ 대리승인/반려 proxy error:', err.message);
          console.error('❌ 에러 코드:', err.code);
          console.error('❌ 에러 상세:', err);
          console.error('❌ 요청 URL:', `https://${options.hostname}:${options.port}${options.path}`);
          reject(err);
        });

        proxyReq.on('timeout', () => {
          console.error('외부 API 타임아웃');
          proxyReq.destroy();
          reject(new Error('Request timeout'));
        });

        proxyReq.write(payload);
        proxyReq.end();
      });

    } catch (error) {
      console.error('대리승인/반려 request error:', error);
      throw error;
    }
  };

  // 재시도 로직
  while (retryCount < maxRetries) {
    try {
      const result = await makeRequest();
      if (result.json) {
        return res.status(result.status).json(result.json);
      } else {
        return res.status(result.status).send(result.data);
      }
    } catch (error) {
      retryCount++;
      console.log(`재시도 ${retryCount}/${maxRetries} 실패:`, error.message);

      if (retryCount >= maxRetries) {
        console.error('최대 재시도 횟수 초과');
        return res.status(502).json({
          status_code: 502,
          error: 'Upstream request failed after retries',
          details: error.message
        });
      }

      // 재시도 전 대기 (지수 백오프)
      const delay = Math.pow(2, retryCount) * 1000;
      console.log(`${delay}ms 후 재시도...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
});

// Proxy: 사용자 삭제 API (라우터 등록 직후에 위치)
app.post('/api/admin/deleteUser', (req, res) => {
  try {
    console.log('=== 사용자 삭제 API 요청 ===');
    console.log('요청 본문:', req.body);
    
    const { user_id, password, delete_user_id } = req.body || {};
    
    if (!user_id || !password || !delete_user_id) {
      console.log('필수 파라미터 누락:', { user_id: !!user_id, password: !!password, delete_user_id });
      return res.status(400).json({ 
        status_code: 400, 
        error: 'user_id, password, delete_user_id are required' 
      });
    }

    // 관리자 계정의 admin_role을 DB에서 확인
    const db = require('./config/db');
    db.query(
      'SELECT admin_role FROM "aiagent_schema"."user" WHERE user_id = $1',
      [user_id]
    ).then(result => {
      if (result.rows.length === 0) {
        return res.status(401).json({
          status_code: 401,
          error: '관리자 계정을 찾을 수 없습니다.'
        });
      }

      const adminRole = result.rows[0].admin_role;
      console.log('관리자 계정 정보:', { user_id, admin_role: adminRole });

      // admin_role이 0인 경우만 삭제 가능
      if (adminRole !== 0) {
        return res.status(403).json({
          status_code: 403,
          error: 'admin_role 값이 0인 계정만 사용자를 삭제할 수 있습니다.'
        });
      }

      // 외부 API로 요청 전달
      const payload = JSON.stringify({ user_id, password, delete_user_id });
      console.log('외부 API 호출 페이로드:', payload);

      const options = {
        hostname: UPSTREAM_HOST,
        port: UPSTREAM_PORT,
        path: '/admin/deleteUser',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 10000
      };

      console.log('외부 API 옵션:', options);

      const proxyReq = https.request(options, (proxyRes) => {
        console.log('외부 API 응답 상태:', proxyRes.statusCode);
        let data = '';
        
        proxyRes.on('data', (chunk) => { 
          data += chunk; 
          console.log('응답 데이터 청크:', chunk.toString());
        });
        
        proxyRes.on('end', () => {
          console.log('외부 API 응답 완료:', data);
          const status = proxyRes.statusCode || 500;
          try {
            const json = data ? JSON.parse(data) : {};
            console.log('파싱된 응답:', json);
            return res.status(status).json(json);
          } catch (e) {
            console.error('JSON 파싱 오류:', e);
            return res.status(status).send(data);
          }
        });
      });

      proxyReq.on('error', (err) => {
        console.error('사용자 삭제 proxy error:', err.message);
        console.error('에러 상세:', err);
        return res.status(502).json({ 
          status_code: 502, 
          error: `Upstream request failed: ${err.message}` 
        });
      });

      proxyReq.on('timeout', () => {
        console.error('외부 API 타임아웃');
        proxyReq.destroy();
        return res.status(504).json({ 
          status_code: 504, 
          error: 'Request timeout' 
        });
      });

      proxyReq.write(payload);
      proxyReq.end();

    }).catch(error => {
      console.error('관리자 계정 조회 오류:', error);
      return res.status(500).json({ 
        status_code: 500, 
        error: '서버 오류가 발생했습니다.' 
      });
    });

  } catch (error) {
    console.error('사용자 삭제 proxy handler error:', error);
    return res.status(500).json({ 
      status_code: 500, 
      error: `Internal server error: ${error.message}` 
    });
  }
});

// Proxy: createUser API
app.post('/admin/createUser', (req, res) => {
  try {
    console.log('=== 사용자 추가 API 요청 ===');
    console.log('요청 본문:', JSON.stringify(req.body, null, 2));

    const { user_id, name } = req.body || {};

    if (!user_id || !name) {
      console.log('필수 파라미터 누락:', { user_id: !!user_id, name: !!name });
      return res.status(400).json({
        status_code: 400,
        error: 'user_id and name are required'
      });
    }

    const payload = JSON.stringify(req.body);
    console.log('외부 API 호출 페이로드:', payload);

    const options = {
      hostname: UPSTREAM_HOST,
      port: UPSTREAM_PORT,
      path: '/admin/createUser',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 10000
    };

    console.log('외부 API 옵션:', options);

    const proxyReq = https.request(options, (proxyRes) => {
      console.log('외부 API 응답 상태:', proxyRes.statusCode);
      let data = '';

      proxyRes.on('data', (chunk) => {
        data += chunk;
      });

      proxyRes.on('end', () => {
        console.log('외부 API 응답 완료:', data);
        const status = proxyRes.statusCode || 500;
        try {
          const json = data ? JSON.parse(data) : {};
          console.log('파싱된 응답:', json);
          return res.status(status).json(json);
        } catch (e) {
          console.error('JSON 파싱 오류:', e);
          return res.status(status).send(data);
        }
      });
    });

    proxyReq.on('error', (err) => {
      console.error('사용자 추가 proxy error:', err.message);
      console.error('에러 상세:', err);
      return res.status(502).json({
        status_code: 502,
        error: `Upstream request failed: ${err.message}`
      });
    });

    proxyReq.on('timeout', () => {
      console.error('외부 API 타임아웃');
      proxyReq.destroy();
      return res.status(504).json({
        status_code: 504,
        error: 'Request timeout'
      });
    });

    proxyReq.write(payload);
    proxyReq.end();
  } catch (error) {
    console.error('사용자 추가 proxy handler error:', error);
    return res.status(500).json({
      status_code: 500,
      error: `Internal server error: ${error.message}`
    });
  }
});

// Proxy: updateUser API
app.post('/admin/updateUser', (req, res) => {
  try {
    console.log('=== 사용자 업데이트 API 요청 ===');
    console.log('요청 본문:', JSON.stringify(req.body, null, 2));

    const { user_id, dept, job_grade, job_position, permission, csr_search_div, admin_role, is_worked, resign_date } = req.body || {};

    if (!user_id) {
      console.log('필수 파라미터 누락: user_id');
      return res.status(400).json({
        status_code: 400,
        error: 'user_id is required'
      });
    }

    const payload = JSON.stringify(req.body);
    console.log('외부 API 호출 페이로드:', payload);

    const options = {
      hostname: UPSTREAM_HOST,
      port: UPSTREAM_PORT,
      path: '/admin/updateUser',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 10000
    };

    console.log('외부 API 옵션:', options);

    const proxyReq = https.request(options, (proxyRes) => {
      console.log('외부 API 응답 상태:', proxyRes.statusCode);
      let data = '';

      proxyRes.on('data', (chunk) => {
        data += chunk;
      });

      proxyRes.on('end', () => {
        console.log('외부 API 응답 완료:', data);
        const status = proxyRes.statusCode || 500;
        try {
          const json = data ? JSON.parse(data) : {};
          console.log('파싱된 응답:', json);
          return res.status(status).json(json);
        } catch (e) {
          console.error('JSON 파싱 오류:', e);
          return res.status(status).send(data);
        }
      });
    });

    proxyReq.on('error', (err) => {
      console.error('사용자 업데이트 proxy error:', err.message);
      console.error('에러 상세:', err);
      return res.status(502).json({
        status_code: 502,
        error: `Upstream request failed: ${err.message}`
      });
    });

    proxyReq.on('timeout', () => {
      console.error('외부 API 타임아웃');
      proxyReq.destroy();
      return res.status(504).json({
        status_code: 504,
        error: 'Request timeout'
      });
    });

    proxyReq.write(payload);
    proxyReq.end();
  } catch (error) {
    console.error('사용자 업데이트 proxy handler error:', error);
    return res.status(500).json({
      status_code: 500,
      error: `Internal server error: ${error.message}`
    });
  }
});

// Proxy: Leave Grant - request (create new vacation request)
app.post('/api/leave/grant/request', (req, res) => {
  try {
    console.log('=== 휴가 요청 생성 API 요청 ===');
    console.log('요청 본문:', req.body);
    
    const { user_id, leave_type, start_date, end_date, reason, approver_id } = req.body || {};
    if (!user_id || !leave_type || !start_date || !end_date) {
      console.log('필수 파라미터 누락:', { user_id, leave_type, start_date, end_date });
      return res.status(400).json({ status_code: 400, error: 'user_id, leave_type, start_date, end_date are required' });
    }

    const payload = JSON.stringify({ 
      user_id, 
      leave_type, 
      start_date, 
      end_date, 
      reason: reason || '', 
      approver_id: approver_id || '' 
    });
    console.log('외부 API 호출 페이로드:', payload);

    const options = {
      hostname: UPSTREAM_HOST,
      port: UPSTREAM_PORT,
      path: '/leave/grant/request',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 10000  // 10초 타임아웃 추가
    };

    console.log('외부 API 옵션:', options);

    const proxyReq = https.request(options, (proxyRes) => {
      console.log('외부 API 응답 상태:', proxyRes.statusCode);
      let data = '';
      
      proxyRes.on('data', (chunk) => { 
        data += chunk; 
        console.log('응답 데이터 청크:', chunk.toString());
      });
      
      proxyRes.on('end', () => {
        console.log('외부 API 응답 완료:', data);
        const status = proxyRes.statusCode || 500;
        try {
          const json = data ? JSON.parse(data) : {};
          console.log('파싱된 응답:', json);
          return res.status(status).json(json);
        } catch (e) {
          console.error('JSON 파싱 오류:', e);
          return res.status(status).send(data);
        }
      });
    });

    proxyReq.on('error', (err) => {
      console.error('Leave grant request proxy error:', err.message);
      console.error('에러 상세:', err);
      return res.status(502).json({ status_code: 502, error: 'Upstream request failed' });
    });

    proxyReq.write(payload);
    proxyReq.end();
  } catch (error) {
    console.error('Leave grant request proxy handler error:', error);
    return res.status(500).json({ status_code: 500, error: 'Internal server error' });
  }
});

// Proxy: Leave Grant - getRequestList (to avoid CORS on client)
app.post('/api/leave/grant/getRequestList', (req, res) => {
  try {
    console.log('=== 휴가 요청 목록 조회 API 요청 ===');
    console.log('요청 본문:', req.body);
    console.log('쿼리 파라미터:', req.query);

    const { user_id, department, leave_type } = req.body || {};
    if (!user_id) {
      console.log('필수 파라미터 누락: user_id');
      return res.status(400).json({ status_code: 400, error: 'user_id is required' });
    }

    // 페이지네이션 파라미터
    const page = req.query.page || 1;
    const pageSize = req.query.page_size || 10;

    // 요청 페이로드 구성
    const requestPayload = { user_id };
    if (department) {
      requestPayload.department = department;
    }
    if (leave_type) {
      requestPayload.leave_type = leave_type;
    }

    const payload = JSON.stringify(requestPayload);
    console.log('외부 API 호출 페이로드:', payload);

    const options = {
      hostname: UPSTREAM_HOST,
      port: UPSTREAM_PORT,
      path: `/leave/grant/getRequestList?page=${page}&page_size=${pageSize}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
        // If the upstream starts requiring auth, add it here safely
        // 'Authorization': `Bearer ${process.env.LEAVE_API_TOKEN}`
      },
      timeout: 10000  // 10초 타임아웃 추가
    };

    console.log('외부 API 옵션:', options);

    const proxyReq = https.request(options, (proxyRes) => {
      console.log('외부 API 응답 상태:', proxyRes.statusCode);
      let data = '';
      
      proxyRes.on('data', (chunk) => { 
        data += chunk; 
        console.log('응답 데이터 청크:', chunk.toString());
      });
      
      proxyRes.on('end', () => {
        console.log('외부 API 응답 완료:', data);
        const status = proxyRes.statusCode || 500;
        try {
          const json = data ? JSON.parse(data) : {};
          console.log('파싱된 응답:', json);
          return res.status(status).json(json);
        } catch (e) {
          console.error('JSON 파싱 오류:', e);
          return res.status(status).send(data);
        }
      });
    });

    proxyReq.on('error', (err) => {
      console.error('Leave grant proxy error:', err.message);
      console.error('에러 상세:', err);
      return res.status(502).json({ status_code: 502, error: 'Upstream request failed' });
    });

    proxyReq.write(payload);
    proxyReq.end();
  } catch (error) {
    console.error('Leave grant proxy handler error:', error);
    return res.status(500).json({ status_code: 500, error: 'Internal server error' });
  }
});

// Proxy: Leave Grant - management (부여 내역 조회)
app.post('/api/leave/grant/management', (req, res) => {
  try {
    console.log('=== 휴가 부여 내역 조회 API 요청 ===');
    console.log('요청 본문:', req.body);
    console.log('쿼리 파라미터:', req.query);
    
    const { user_id } = req.body || {};
    if (!user_id) {
      console.log('필수 파라미터 누락: user_id');
      return res.status(400).json({ status_code: 400, error: 'user_id is required' });
    }

    // 페이지네이션 파라미터
    const page = req.query.page || 1;
    const pageSize = req.query.page_size || 10;

    const payload = JSON.stringify({ user_id });
    console.log('외부 API 호출 페이로드:', payload);

    const options = {
      hostname: UPSTREAM_HOST,
      port: UPSTREAM_PORT,
      path: `/leave/grant/management?page=${page}&page_size=${pageSize}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 10000
    };

    console.log('외부 API 옵션:', options);

    const proxyReq = https.request(options, (proxyRes) => {
      console.log('외부 API 응답 상태:', proxyRes.statusCode);
      let data = '';
      
      proxyRes.on('data', (chunk) => { 
        data += chunk; 
        console.log('응답 데이터 청크:', chunk.toString());
      });
      
      proxyRes.on('end', () => {
        console.log('외부 API 응답 완료:', data);
        const status = proxyRes.statusCode || 500;
        try {
          const json = data ? JSON.parse(data) : {};
          console.log('파싱된 응답:', json);
          return res.status(status).json(json);
        } catch (e) {
          console.error('JSON 파싱 오류:', e);
          return res.status(status).send(data);
        }
      });
    });

    proxyReq.on('error', (err) => {
      console.error('Leave grant management proxy error:', err.message);
      console.error('에러 상세:', err);
      return res.status(502).json({ status_code: 502, error: 'Upstream request failed' });
    });

    proxyReq.write(payload);
    proxyReq.end();
  } catch (error) {
    console.error('Leave grant management proxy handler error:', error);
    return res.status(500).json({ status_code: 500, error: 'Internal server error' });
  }
});

// Proxy: Leave Grant - management/detail (메모/첨부파일 조회)
app.post('/api/leave/grant/management/detail', (req, res) => {
  try {
    console.log('=== 휴가 부여 내역 메모 조회 API 요청 ===');
    console.log('요청 본문:', req.body);
    
    const { id } = req.body || {};
    if (!id) {
      console.log('필수 파라미터 누락: id');
      return res.status(400).json({ status_code: 400, error: 'id is required' });
    }

    const payload = JSON.stringify({ id });
    console.log('외부 API 호출 페이로드:', payload);

    const options = {
      hostname: UPSTREAM_HOST,
      port: UPSTREAM_PORT,
      path: '/leave/grant/management/detail',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 10000
    };

    console.log('외부 API 옵션:', options);

    const proxyReq = https.request(options, (proxyRes) => {
      console.log('외부 API 응답 상태:', proxyRes.statusCode);
      let data = '';
      
      proxyRes.on('data', (chunk) => { 
        data += chunk; 
      });
      
      proxyRes.on('end', () => {
        console.log('외부 API 응답 완료:', data);
        const status = proxyRes.statusCode || 500;
        try {
          const json = data ? JSON.parse(data) : {};
          console.log('파싱된 응답:', json);
          return res.status(status).json(json);
        } catch (e) {
          console.error('JSON 파싱 오류:', e);
          return res.status(status).send(data);
        }
      });
    });

    proxyReq.on('error', (err) => {
      console.error('Leave grant detail proxy error:', err.message);
      console.error('에러 상세:', err);
      return res.status(502).json({ status_code: 502, error: 'Upstream request failed' });
    });

    proxyReq.write(payload);
    proxyReq.end();
  } catch (error) {
    console.error('Leave grant detail proxy handler error:', error);
    return res.status(500).json({ status_code: 500, error: 'Internal server error' });
  }
});

// Proxy: Leave Grant - approval (approve/reject)
app.post('/api/leave/grant/approval', async (req, res) => {
  const maxRetries = 3;
  let retryCount = 0;

  const makeRequest = async () => {
    try {
      console.log('=== 휴가 승인 API 요청 ===');
      console.log('요청 본문:', req.body);
      console.log(`재시도 횟수: ${retryCount}/${maxRetries}`);
      
      const { id, approver_id, is_approved, comment } = req.body || {};
      if (!id || !approver_id || typeof is_approved !== 'string') {
        console.log('필수 파라미터 누락:', { id, approver_id, is_approved });
        return res.status(400).json({ status_code: 400, error: 'id, approver_id, is_approved are required' });
      }

      // is_approved 값을 올바른 형식으로 변환
      let approvalStatus = is_approved;
      if (is_approved === 'Y' || is_approved === 'true') {
        approvalStatus = 'APPROVED';
      } else if (is_approved === 'N' || is_approved === 'false') {
        approvalStatus = 'REJECTED';
      }

      const payload = JSON.stringify({ id: id, approver_id, is_approved: approvalStatus, comment: comment || '' });
      console.log('외부 API 호출 페이로드:', payload);

      const options = {
        hostname: UPSTREAM_HOST,
        port: UPSTREAM_PORT,
        path: '/leave/grant/approval',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'Connection': 'keep-alive',
          'User-Agent': 'Node.js Admin Panel'
        },
        timeout: 30000,  // 30초로 증가
        keepAlive: true,
        keepAliveMsecs: 1000
      };

      console.log('외부 API 옵션:', options);

      return new Promise((resolve, reject) => {
        const proxyReq = https.request(options, (proxyRes) => {
          console.log('외부 API 응답 상태:', proxyRes.statusCode);
          let data = '';
          
          proxyRes.on('data', (chunk) => { 
            data += chunk; 
            console.log('응답 데이터 청크:', chunk.toString());
          });
          
          proxyRes.on('end', () => {
            console.log('외부 API 응답 완료:', data);
            const status = proxyRes.statusCode || 500;
            try {
              const json = data ? JSON.parse(data) : {};
              console.log('파싱된 응답:', json);
              resolve({ status, json });
            } catch (e) {
              console.error('JSON 파싱 오류:', e);
              resolve({ status, data });
            }
          });
        });

        proxyReq.on('error', (err) => {
          console.error('Leave grant approval proxy error:', err.message);
          console.error('에러 상세:', err);
          reject(err);
        });

        proxyReq.on('timeout', () => {
          console.error('요청 타임아웃');
          proxyReq.destroy();
          reject(new Error('Request timeout'));
        });

        proxyReq.write(payload);
        proxyReq.end();
      });

    } catch (error) {
      console.error('Leave grant approval proxy handler error:', error);
      throw error;
    }
  };

  // 재시도 로직
  while (retryCount < maxRetries) {
    try {
      const result = await makeRequest();
      return res.status(result.status).json(result.json || result.data);
    } catch (error) {
      retryCount++;
      console.log(`재시도 ${retryCount}/${maxRetries} 실패:`, error.message);
      
      if (retryCount >= maxRetries) {
        console.error('최대 재시도 횟수 초과');
        return res.status(502).json({ 
          status_code: 502, 
          error: 'Upstream request failed after retries',
          details: error.message 
        });
      }
      
      // 재시도 전 대기 (지수 백오프)
      const delay = Math.pow(2, retryCount) * 1000;
      console.log(`${delay}ms 후 재시도...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
});

// Proxy: getDepartmentList (부서 목록 조회)
app.get('/api/getDepartmentList', (req, res) => {
  try {
    console.log('=== 부서 목록 조회 API 요청 ===');

    const options = {
      hostname: UPSTREAM_HOST,
      port: UPSTREAM_PORT,
      path: '/api/getDepartmentList',
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      },
      timeout: 10000
    };

    console.log('외부 API 옵션:', options);

    const proxyReq = https.request(options, (proxyRes) => {
      console.log('외부 API 응답 상태:', proxyRes.statusCode);
      let data = '';

      proxyRes.on('data', (chunk) => {
        data += chunk;
      });

      proxyRes.on('end', () => {
        console.log('외부 API 응답 완료:', data);
        const status = proxyRes.statusCode || 500;
        try {
          const json = data ? JSON.parse(data) : {};
          console.log('파싱된 응답:', json);
          return res.status(status).json(json);
        } catch (e) {
          console.error('JSON 파싱 오류:', e);
          return res.status(status).send(data);
        }
      });
    });

    proxyReq.on('error', (err) => {
      console.error('부서 목록 조회 proxy error:', err.message);
      return res.status(502).json({
        status_code: 502,
        error: `Upstream request failed: ${err.message}`
      });
    });

    proxyReq.on('timeout', () => {
      console.error('외부 API 타임아웃');
      proxyReq.destroy();
      return res.status(504).json({
        status_code: 504,
        error: 'Request timeout'
      });
    });

    proxyReq.end();
  } catch (error) {
    console.error('부서 목록 조회 proxy handler error:', error);
    return res.status(500).json({
      status_code: 500,
      error: `Internal server error: ${error.message}`
    });
  }
});

// Proxy: getDepartmentMembers (부서원 목록 조회)
app.get('/api/getDepartmentMembers', (req, res) => {
  try {
    const department = req.query.department;
    console.log('=== 부서원 목록 조회 API 요청 ===');
    console.log('부서:', department);

    if (!department) {
      return res.status(400).json({
        status_code: 400,
        error: 'department parameter is required'
      });
    }

    const options = {
      hostname: UPSTREAM_HOST,
      port: UPSTREAM_PORT,
      path: `/api/getDepartmentMembers?department=${encodeURIComponent(department)}`,
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      },
      timeout: 10000
    };

    console.log('외부 API 옵션:', options);

    const proxyReq = https.request(options, (proxyRes) => {
      console.log('외부 API 응답 상태:', proxyRes.statusCode);
      let data = '';

      proxyRes.on('data', (chunk) => {
        data += chunk;
      });

      proxyRes.on('end', () => {
        console.log('외부 API 응답 완료:', data);
        const status = proxyRes.statusCode || 500;
        try {
          const json = data ? JSON.parse(data) : {};
          console.log('파싱된 응답:', json);
          return res.status(status).json(json);
        } catch (e) {
          console.error('JSON 파싱 오류:', e);
          return res.status(status).send(data);
        }
      });
    });

    proxyReq.on('error', (err) => {
      console.error('부서원 목록 조회 proxy error:', err.message);
      return res.status(502).json({
        status_code: 502,
        error: `Upstream request failed: ${err.message}`
      });
    });

    proxyReq.on('timeout', () => {
      console.error('외부 API 타임아웃');
      proxyReq.destroy();
      return res.status(504).json({
        status_code: 504,
        error: 'Request timeout'
      });
    });

    proxyReq.end();
  } catch (error) {
    console.error('부서원 목록 조회 proxy handler error:', error);
    return res.status(500).json({
      status_code: 500,
      error: `Internal server error: ${error.message}`
    });
  }
});

// Proxy: getUpdatePrivacyCount (개인정보 동의 추이 조회)
app.post('/api/getUpdatePrivacyCount', (req, res) => {
  try {
    console.log('=== 개인정보 동의 추이 조회 API 요청 ===');
    console.log('요청 본문:', req.body);

    const payload = JSON.stringify(req.body || {});
    const options = {
      hostname: UPSTREAM_HOST,
      port: UPSTREAM_PORT,
      path: '/api/getUpdatePrivacyCount',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 10000
    };

    console.log('외부 API 옵션:', options);

    const proxyReq = https.request(options, (proxyRes) => {
      console.log('외부 API 응답 상태:', proxyRes.statusCode);
      let data = '';

      proxyRes.on('data', (chunk) => {
        data += chunk;
      });

      proxyRes.on('end', () => {
        console.log('외부 API 응답 완료:', data);
        const status = proxyRes.statusCode || 500;
        try {
          const json = data ? JSON.parse(data) : {};
          console.log('파싱된 응답:', json);
          return res.status(status).json(json);
        } catch (e) {
          console.error('JSON 파싱 오류:', e);
          return res.status(status).send(data);
        }
      });
    });

    proxyReq.on('error', (err) => {
      console.error('개인정보 동의 추이 조회 proxy error:', err.message);
      return res.status(502).json({
        status_code: 502,
        error: `Upstream request failed: ${err.message}`
      });
    });

    proxyReq.on('timeout', () => {
      console.error('외부 API 타임아웃');
      proxyReq.destroy();
      return res.status(504).json({
        status_code: 504,
        error: 'Request timeout'
      });
    });

    proxyReq.write(payload);
    proxyReq.end();
  } catch (error) {
    console.error('개인정보 동의 추이 조회 proxy handler error:', error);
    return res.status(500).json({
      status_code: 500,
      error: `Internal server error: ${error.message}`
    });
  }
});

// Proxy: setApprover (승인자 지정)
app.post('/admin/leave/setApprover', (req, res) => {
  try {
    console.log('=== 승인자 지정 API 요청 ===');
    console.log('요청 본문:', req.body);

    const { admin_id, approver_id } = req.body || {};

    if (!admin_id || !approver_id) {
      console.log('필수 파라미터 누락:', { admin_id, approver_id });
      return res.status(400).json({
        status_code: 400,
        error: 'admin_id and approver_id are required'
      });
    }

    const payload = JSON.stringify({ admin_id, approver_id });
    console.log('외부 API 호출 페이로드:', payload);

    const options = {
      hostname: UPSTREAM_HOST,
      port: UPSTREAM_PORT,
      path: '/admin/leave/setApprover',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 10000
    };

    console.log('외부 API 옵션:', options);

    const proxyReq = https.request(options, (proxyRes) => {
      console.log('외부 API 응답 상태:', proxyRes.statusCode);
      let data = '';

      proxyRes.on('data', (chunk) => {
        data += chunk;
      });

      proxyRes.on('end', () => {
        console.log('외부 API 응답 완료:', data);
        const status = proxyRes.statusCode || 500;
        try {
          const json = data ? JSON.parse(data) : {};
          console.log('파싱된 응답:', json);
          return res.status(status).json(json);
        } catch (e) {
          console.error('JSON 파싱 오류:', e);
          return res.status(status).send(data);
        }
      });
    });

    proxyReq.on('error', (err) => {
      console.error('승인자 지정 proxy error:', err.message);
      return res.status(502).json({
        status_code: 502,
        error: `Upstream request failed: ${err.message}`
      });
    });

    proxyReq.on('timeout', () => {
      console.error('외부 API 타임아웃');
      proxyReq.destroy();
      return res.status(504).json({
        status_code: 504,
        error: 'Request timeout'
      });
    });

    proxyReq.write(payload);
    proxyReq.end();
  } catch (error) {
    console.error('승인자 지정 proxy handler error:', error);
    return res.status(500).json({
      status_code: 500,
      error: `Internal server error: ${error.message}`
    });
  }
});

// Proxy: getApprover (승인자 목록 조회)
app.post('/leave/user/getApprover', (req, res) => {
  try {
    console.log('=== 승인자 목록 조회 API 요청 ===');

    const options = {
      hostname: UPSTREAM_HOST,
      port: UPSTREAM_PORT,
      path: '/leave/user/getApprover',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': 0
      },
      timeout: 10000
    };

    console.log('외부 API 옵션:', options);

    const proxyReq = https.request(options, (proxyRes) => {
      console.log('외부 API 응답 상태:', proxyRes.statusCode);
      let data = '';

      proxyRes.on('data', (chunk) => {
        data += chunk;
      });

      proxyRes.on('end', () => {
        console.log('외부 API 응답 완료:', data);
        const status = proxyRes.statusCode || 500;
        try {
          const json = data ? JSON.parse(data) : {};
          console.log('파싱된 응답:', json);
          return res.status(status).json(json);
        } catch (e) {
          console.error('JSON 파싱 오류:', e);
          return res.status(status).send(data);
        }
      });
    });

    proxyReq.on('error', (err) => {
      console.error('승인자 목록 조회 proxy error:', err.message);
      return res.status(502).json({
        status_code: 502,
        error: `Upstream request failed: ${err.message}`
      });
    });

    proxyReq.on('timeout', () => {
      console.error('외부 API 타임아웃');
      proxyReq.destroy();
      return res.status(504).json({
        status_code: 504,
        error: 'Request timeout'
      });
    });

    proxyReq.end();
  } catch (error) {
    console.error('승인자 목록 조회 proxy handler error:', error);
    return res.status(500).json({
      status_code: 500,
      error: `Internal server error: ${error.message}`
    });
  }
});

// Proxy: leave management history (휴가 신청 이력 조회)
app.post('/admin/leave/management/history', (req, res) => {
  try {
        console.log('=== 휴가 신청 이력 조회 API 요청 ===');
        console.log('요청 본문:', req.body);
        console.log('쿼리 파라미터:', req.query);

        const { year, view_type, department, leave_type, name } = req.body || {};
        const page = req.query.page || 1;
        const page_size = req.query.page_size || 20;

        const payloadBody = {
          view_type: view_type || '',
          department: department || '',
          leave_type: leave_type || ''
        };

        if (year !== undefined && year !== null && year !== '') {
          payloadBody.year = year;
        }

        if (name) {
          payloadBody.name = name;
        }

        const payload = JSON.stringify(payloadBody);
        console.log('외부 API 호출 페이로드:', payload);

        const options = {
          hostname: UPSTREAM_HOST,
          port: UPSTREAM_PORT,
          path: `/admin/leave/management/history?page=${page}&page_size=${page_size}`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
          },
          timeout: 10000
        };

        console.log('외부 API 옵션:', options);

        const proxyReq = https.request(options, (proxyRes) => {
          console.log('외부 API 응답 상태:', proxyRes.statusCode);
          let data = '';

          proxyRes.on('data', (chunk) => {
            data += chunk;
          });

          proxyRes.on('end', () => {
            console.log('외부 API 응답 완료:', data);
            const status = proxyRes.statusCode || 500;
            try {
              const json = data ? JSON.parse(data) : {};
              console.log('파싱된 응답:', json);

              // status 값 변환 로직 추가
              if (json.leaves && Array.isArray(json.leaves)) {
                json.leaves = json.leaves.map(leave => {
                  if (leave.status === 'CANCEL_REQUESTED') {
                    return { ...leave, status: '취소대기' };
                  }
                  return leave;
                });
              }

              console.log('휴가 신청 이력 응답:', json);
              return res.status(status).json(json);
            } catch (e) {
              console.error('JSON 파싱 오류:', e);
              return res.status(status).send(data);
            }
          });
        });

    proxyReq.on('error', (err) => {
      console.error('휴가 신청 이력 조회 proxy error:', err.message);
      return res.status(502).json({
        status_code: 502,
        error: `Upstream request failed: ${err.message}`
      });
    });

    proxyReq.on('timeout', () => {
      console.error('외부 API 타임아웃');
      proxyReq.destroy();
      return res.status(504).json({
        status_code: 504,
        error: 'Request timeout'
      });
    });

    proxyReq.write(payload);
    proxyReq.end();
  } catch (error) {
    console.error('휴가 신청 이력 조회 proxy handler error:', error);
    return res.status(500).json({
      status_code: 500,
      error: `Internal server error: ${error.message}`
    });
  }
});

// Proxy: leave management history excel (휴가 신청 이력 엑셀 다운로드)
app.post('/admin/leave/management/history/excel', (req, res) => {
  try {
    console.log('=== 휴가 신청 이력 엑셀 다운로드 API 요청 ===');
    console.log('요청 본문:', req.body);

    const {
      year,
      view_type,
      department,
      leave_type,
      name,
      start_date,
      end_date,
      requested_start_date,
      requested_end_date
    } = req.body || {};

    const payloadBody = {};

    if (year !== undefined && year !== null && year !== '') {
      payloadBody.year = year;
    }
    if (view_type) payloadBody.view_type = view_type;
    if (department) payloadBody.department = department;
    if (leave_type) payloadBody.leave_type = leave_type;
    if (name) payloadBody.name = name;
    if (start_date) payloadBody.start_date = start_date;
    if (end_date) payloadBody.end_date = end_date;
    if (requested_start_date) payloadBody.requested_start_date = requested_start_date;
    if (requested_end_date) payloadBody.requested_end_date = requested_end_date;

    const payload = JSON.stringify(payloadBody);
    console.log('외부 API 호출 페이로드:', payload);

    const options = {
      hostname: UPSTREAM_HOST,
      port: UPSTREAM_PORT,
      path: '/admin/leave/management/history/excel',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 30000
    };

    console.log('외부 API 옵션:', options);

    const proxyReq = https.request(options, (proxyRes) => {
      const status = proxyRes.statusCode || 500;
      const contentType = proxyRes.headers['content-type'] || '';
      const contentDisposition = proxyRes.headers['content-disposition'];
      console.log('외부 API 응답 상태:', status);
      console.log('외부 API 응답 content-type:', contentType);

      // 성공 시 바이너리(xlsx) 스트림 그대로 전달
      if (
        status === 200 &&
        typeof contentType === 'string' &&
        contentType.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      ) {
        res.status(status);
        res.setHeader('Content-Type', contentType);
        if (contentDisposition) {
          res.setHeader('Content-Disposition', contentDisposition);
        }
        proxyRes.pipe(res);
        return;
      }

      // 실패 응답은 JSON/text 처리
      const chunks = [];
      proxyRes.on('data', (chunk) => {
        chunks.push(chunk);
      });

      proxyRes.on('end', () => {
        const data = Buffer.concat(chunks).toString('utf8');
        console.log('외부 API 응답 완료:', data);
        try {
          const json = data ? JSON.parse(data) : {};
          console.log('파싱된 응답:', json);
          return res.status(status).json(json);
        } catch (e) {
          console.error('JSON 파싱 오류:', e);
          return res.status(status).send(data);
        }
      });
    });

    proxyReq.on('error', (err) => {
      console.error('휴가 신청 이력 엑셀 다운로드 proxy error:', err.message);
      return res.status(502).json({
        status_code: 502,
        error: `Upstream request failed: ${err.message}`
      });
    });

    proxyReq.on('timeout', () => {
      console.error('외부 API 타임아웃');
      proxyReq.destroy();
      return res.status(504).json({
        status_code: 504,
        error: 'Request timeout'
      });
    });

    proxyReq.write(payload);
    proxyReq.end();
  } catch (error) {
    console.error('휴가 신청 이력 엑셀 다운로드 proxy handler error:', error);
    return res.status(500).json({
      status_code: 500,
      error: `Internal server error: ${error.message}`
    });
  }
});

// Proxy: leave management (전사원 휴가현황)
app.post('/admin/leave/management', (req, res) => {
  try {
    console.log('=== 전사원 휴가현황 API 요청 ===');
    console.log('요청 본문:', req.body);
    console.log('쿼리 파라미터:', req.query);

    const page = req.query.page || 1;
    const page_size = req.query.page_size || 20;
    const payload = JSON.stringify(req.body || {});

    const options = {
      hostname: UPSTREAM_HOST,
      port: UPSTREAM_PORT,
      path: `/admin/leave/management?page=${page}&page_size=${page_size}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 10000
    };

    console.log('외부 API 옵션:', options);

    const proxyReq = https.request(options, (proxyRes) => {
      console.log('외부 API 응답 상태:', proxyRes.statusCode);
      let data = '';

      proxyRes.on('data', (chunk) => {
        data += chunk;
      });

      proxyRes.on('end', () => {
        console.log('외부 API 응답 완료:', data);
        const status = proxyRes.statusCode || 500;
        try {
          const json = data ? JSON.parse(data) : {};
          console.log('파싱된 응답:', json);
          return res.status(status).json(json);
        } catch (e) {
          console.error('JSON 파싱 오류:', e);
          return res.status(status).send(data);
        }
      });
    });

    proxyReq.on('error', (err) => {
      console.error('전사원 휴가현황 proxy error:', err.message);
      return res.status(502).json({
        status_code: 502,
        error: `Upstream request failed: ${err.message}`
      });
    });

    proxyReq.on('timeout', () => {
      console.error('외부 API 타임아웃');
      proxyReq.destroy();
      return res.status(504).json({
        status_code: 504,
        error: 'Request timeout'
      });
    });

    proxyReq.write(payload);
    proxyReq.end();
  } catch (error) {
    console.error('전사원 휴가현황 proxy handler error:', error);
    return res.status(500).json({
      status_code: 500,
      error: `Internal server error: ${error.message}`
    });
  }
});

// Proxy: leave custom grant (임의휴가부여)
app.post('/admin/leave/customGrant', (req, res) => {
  try {
    console.log('=== 임의휴가부여 API 요청 ===');
    console.log('요청 본문:', req.body);

    const payload = JSON.stringify(req.body || {});

    const options = {
      hostname: UPSTREAM_HOST,
      port: UPSTREAM_PORT,
      path: '/admin/leave/customGrant',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 10000
    };

    console.log('외부 API 옵션:', options);

    const proxyReq = https.request(options, (proxyRes) => {
      console.log('외부 API 응답 상태:', proxyRes.statusCode);
      let data = '';

      proxyRes.on('data', (chunk) => {
        data += chunk;
      });

      proxyRes.on('end', () => {
        console.log('외부 API 응답 완료:', data);
        const status = proxyRes.statusCode || 500;
        try {
          const json = data ? JSON.parse(data) : {};
          console.log('파싱된 응답:', json);
          return res.status(status).json(json);
        } catch (e) {
          console.error('JSON 파싱 오류:', e);
          return res.status(status).send(data);
        }
      });
    });

    proxyReq.on('error', (err) => {
      console.error('임의휴가부여 proxy error:', err.message);
      return res.status(502).json({
        status_code: 502,
        error: `Upstream request failed: ${err.message}`
      });
    });

    proxyReq.on('timeout', () => {
      console.error('외부 API 타임아웃');
      proxyReq.destroy();
      return res.status(504).json({
        status_code: 504,
        error: 'Request timeout'
      });
    });

    proxyReq.write(payload);
    proxyReq.end();
  } catch (error) {
    console.error('임의휴가부여 proxy handler error:', error);
    return res.status(500).json({
      status_code: 500,
      error: `Internal server error: ${error.message}`
    });
  }
});

// Proxy: leave management approval history (휴가 승인 이력 조회)
app.get('/admin/leave/management/approvalHistory', (req, res) => {
  try {
    console.log('=== 휴가 승인 이력 조회 API 요청 ===');
    console.log('쿼리 파라미터:', req.query);

    const { id } = req.query;

    if (!id) {
      console.log('필수 파라미터 누락: id');
      return res.status(400).json({
        status_code: 400,
        error: 'id is required'
      });
    }

    const options = {
      hostname: UPSTREAM_HOST,
      port: UPSTREAM_PORT,
      path: `/admin/leave/management/approvalHistory?id=${id}`,
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 10000
    };

    console.log('외부 API 옵션:', options);

    const proxyReq = https.request(options, (proxyRes) => {
      console.log('외부 API 응답 상태:', proxyRes.statusCode);
      let data = '';

      proxyRes.on('data', (chunk) => {
        data += chunk;
      });

      proxyRes.on('end', () => {
        console.log('외부 API 응답 완료:', data);
        const status = proxyRes.statusCode || 500;
        try {
          const json = data ? JSON.parse(data) : {};
          console.log('파싱된 응답:', json);
          console.log('승인 이력 응답:', json);
          return res.status(status).json(json);
        } catch (e) {
          console.error('JSON 파싱 오류:', e);
          return res.status(status).send(data);
        }
      });
    });

    proxyReq.on('error', (err) => {
      console.error('Approval history proxy error:', err.message);
      return res.status(502).json({
        status_code: 502,
        error: `Upstream request failed: ${err.message}`
      });
    });

    proxyReq.on('timeout', () => {
      console.error('외부 API 타임아웃');
      proxyReq.destroy();
      return res.status(504).json({
        status_code: 504,
        error: 'Request timeout'
      });
    });

    proxyReq.end();
  } catch (error) {
    console.error('Approval history proxy handler error:', error);
    return res.status(500).json({
      status_code: 500,
      error: `Internal server error: ${error.message}`
    });
  }
});

// Proxy: leave management former (퇴사자 휴가 이력 조회)
app.post('/admin/leave/management/former', (req, res) => {
  try {
    console.log('=== 퇴사자 휴가 이력 조회 API 요청 ===');
    console.log('요청 본문:', req.body);

    const { user_id } = req.body || {};

    if (!user_id) {
      console.log('필수 파라미터 누락: user_id');
      return res.status(400).json({
        status_code: 400,
        error: 'user_id is required'
      });
    }

    const payload = JSON.stringify({ user_id });
    console.log('외부 API 호출 페이로드:', payload);

    const options = {
      hostname: UPSTREAM_HOST,
      port: UPSTREAM_PORT,
      path: '/admin/leave/management/former',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 10000
    };

    console.log('외부 API 옵션:', options);

    const proxyReq = https.request(options, (proxyRes) => {
      console.log('외부 API 응답 상태:', proxyRes.statusCode);
      let data = '';

      proxyRes.on('data', (chunk) => {
        data += chunk;
      });

      proxyRes.on('end', () => {
        console.log('외부 API 응답 완료:', data);
        const status = proxyRes.statusCode || 500;
        try {
          const json = data ? JSON.parse(data) : {};
          console.log('파싱된 응답:', json);
          return res.status(status).json(json);
        } catch (e) {
          console.error('JSON 파싱 오류:', e);
          return res.status(status).send(data);
        }
      });
    });

    proxyReq.on('error', (err) => {
      console.error('Former leave history proxy error:', err.message);
      return res.status(502).json({
        status_code: 502,
        error: `Upstream request failed: ${err.message}`
      });
    });

    proxyReq.on('timeout', () => {
      console.error('외부 API 타임아웃');
      proxyReq.destroy();
      return res.status(504).json({
        status_code: 504,
        error: 'Request timeout'
      });
    });

    proxyReq.write(payload);
    proxyReq.end();
  } catch (error) {
    console.error('Former leave history proxy handler error:', error);
    return res.status(500).json({
      status_code: 500,
      error: `Internal server error: ${error.message}`
    });
  }
});

// Proxy: leave management detail (휴가 상세 내역 조회)
app.post('/admin/leave/management/detail', (req, res) => {
  try {
    console.log('=== 휴가 상세 내역 조회 API 요청 ===');
    console.log('요청 본문:', req.body);

    const { year, user_id } = req.body || {};

    if (!year || !user_id) {
      console.log('필수 파라미터 누락:', { year, user_id });
      return res.status(400).json({
        status_code: 400,
        error: 'year and user_id are required'
      });
    }

    const payload = JSON.stringify({ year, user_id });
    console.log('외부 API 호출 페이로드:', payload);

    const options = {
      hostname: UPSTREAM_HOST,
      port: UPSTREAM_PORT,
      path: '/admin/leave/management/detail',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 10000
    };

    console.log('외부 API 옵션:', options);

    const proxyReq = https.request(options, (proxyRes) => {
      console.log('외부 API 응답 상태:', proxyRes.statusCode);
      let data = '';

      proxyRes.on('data', (chunk) => {
        data += chunk;
      });

      proxyRes.on('end', () => {
        console.log('외부 API 응답 완료:', data);
        const status = proxyRes.statusCode || 500;
        try {
          const json = data ? JSON.parse(data) : {};
          console.log('파싱된 응답:', json);
          return res.status(status).json(json);
        } catch (e) {
          console.error('JSON 파싱 오류:', e);
          return res.status(status).send(data);
        }
      });
    });

    proxyReq.on('error', (err) => {
      console.error('휴가 상세 내역 조회 proxy error:', err.message);
      return res.status(502).json({
        status_code: 502,
        error: `Upstream request failed: ${err.message}`
      });
    });

    proxyReq.on('timeout', () => {
      console.error('외부 API 타임아웃');
      proxyReq.destroy();
      return res.status(504).json({
        status_code: 504,
        error: 'Request timeout'
      });
    });

    proxyReq.write(payload);
    proxyReq.end();
  } catch (error) {
    console.error('휴가 상세 내역 조회 proxy handler error:', error);
    return res.status(500).json({
      status_code: 500,
      error: `Internal server error: ${error.message}`
    });
  }
});

// Proxy: deleteApprover (승인자 제거)
app.post('/admin/leave/deleteApprover', (req, res) => {
  try {
    console.log('=== 승인자 제거 API 요청 ===');
    console.log('요청 본문:', req.body);

    const { admin_id, approver_id } = req.body || {};

    if (!admin_id || !approver_id) {
      console.log('필수 파라미터 누락:', { admin_id, approver_id });
      return res.status(400).json({
        status_code: 400,
        error: 'admin_id and approver_id are required'
      });
    }

    const payload = JSON.stringify({ admin_id, approver_id });
    console.log('외부 API 호출 페이로드:', payload);

    const options = {
      hostname: UPSTREAM_HOST,
      port: UPSTREAM_PORT,
      path: '/admin/leave/deleteApprover',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 10000
    };

    console.log('외부 API 옵션:', options);

    const proxyReq = https.request(options, (proxyRes) => {
      console.log('외부 API 응답 상태:', proxyRes.statusCode);
      let data = '';

      proxyRes.on('data', (chunk) => {
        data += chunk;
      });

      proxyRes.on('end', () => {
        console.log('외부 API 응답 완료:', data);
        const status = proxyRes.statusCode || 500;
        try {
          const json = data ? JSON.parse(data) : {};
          console.log('파싱된 응답:', json);
          return res.status(status).json(json);
        } catch (e) {
          console.error('JSON 파싱 오류:', e);
          return res.status(status).send(data);
        }
      });
    });

    proxyReq.on('error', (err) => {
      console.error('승인자 제거 proxy error:', err.message);
      return res.status(502).json({
        status_code: 502,
        error: `Upstream request failed: ${err.message}`
      });
    });

    proxyReq.on('timeout', () => {
      console.error('외부 API 타임아웃');
      proxyReq.destroy();
      return res.status(504).json({
        status_code: 504,
        error: 'Request timeout'
      });
    });

    proxyReq.write(payload);
    proxyReq.end();
  } catch (error) {
    console.error('승인자 제거 proxy handler error:', error);
    return res.status(500).json({
      status_code: 500,
      error: `Internal server error: ${error.message}`
    });
  }
});

// Proxy: File URL API (첨부파일 미리보기/다운로드)
app.post('/api/getFileUrl', (req, res) => {
  try {
    console.log('=== 첨부파일 URL API 요청 ===');
    console.log('요청 본문:', req.body);
    
    const { file_name, prefix, approval_type, is_download } = req.body || {};
    
    if (!file_name || !prefix || !approval_type) {
      console.log('필수 파라미터 누락:', { file_name, prefix, approval_type });
      return res.status(400).json({ 
        status_code: 400, 
        error: 'file_name, prefix, approval_type are required' 
      });
    }

    const payload = JSON.stringify({ 
      file_name, 
      prefix, 
      approval_type, 
      is_download: is_download !== undefined ? is_download : 1 
    });

    console.log('외부 API 호출 페이로드:', payload);

    const options = {
      // IP로 연결하되, TLS 인증서는 ai2great.com 기준으로 검증되도록 SNI/Host 지정
      hostname: '211.43.205.49',
      servername: 'ai2great.com',
      port: UPSTREAM_PORT,
      path: '/api/getFileUrl',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'Host': 'ai2great.com'
      },
      timeout: 10000  // 10초 타임아웃 추가
    };

    console.log('외부 API 옵션:', options);

    const proxyReq = https.request(options, (proxyRes) => {
      console.log('외부 API 응답 상태:', proxyRes.statusCode);
      let data = '';
      
      proxyRes.on('data', (chunk) => { 
        data += chunk; 
        console.log('응답 데이터 청크:', chunk.toString());
      });
      
      proxyRes.on('end', () => {
        console.log('외부 API 응답 완료:', data);
        const status = proxyRes.statusCode || 500;
        try {
          const json = data ? JSON.parse(data) : {};
          console.log('파싱된 응답:', json);
          return res.status(status).json(json);
        } catch (e) {
          console.error('JSON 파싱 오류:', e);
          return res.status(status).send(data);
        }
      });
    });

    proxyReq.on('error', (err) => {
      console.error('File URL proxy error:', err.message);
      console.error('에러 상세:', err);
      return res.status(502).json({ 
        status_code: 502, 
        error: `Upstream request failed: ${err.message}` 
      });
    });

    proxyReq.on('timeout', () => {
      console.error('외부 API 타임아웃');
      proxyReq.destroy();
      return res.status(504).json({ 
        status_code: 504, 
        error: 'Request timeout' 
      });
    });

    proxyReq.write(payload);
    proxyReq.end();
  } catch (error) {
    console.error('File URL proxy handler error:', error);
    return res.status(500).json({ 
      status_code: 500, 
      error: `Internal server error: ${error.message}` 
    });
  }
});

// Proxy: 비밀번호 초기화 API
app.post('/api/admin/initPassword', (req, res) => {
  try {
    console.log('=== 비밀번호 초기화 API 요청 ===');
    console.log('요청 본문:', req.body);
    
    const { user_id } = req.body || {};
    
    if (!user_id) {
      console.log('필수 파라미터 누락: user_id');
      return res.status(400).json({ 
        status_code: 400, 
        error: 'user_id is required' 
      });
    }

    const payload = JSON.stringify({ user_id });
    console.log('외부 API 호출 페이로드:', payload);

    const options = {
      hostname: UPSTREAM_HOST,
      port: UPSTREAM_PORT,
      path: '/admin/initPassword',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 10000  // 10초 타임아웃
    };

    console.log('외부 API 옵션:', options);

    const proxyReq = https.request(options, (proxyRes) => {
      console.log('외부 API 응답 상태:', proxyRes.statusCode);
      let data = '';
      
      proxyRes.on('data', (chunk) => { 
        data += chunk; 
        console.log('응답 데이터 청크:', chunk.toString());
      });
      
      proxyRes.on('end', () => {
        console.log('외부 API 응답 완료:', data);
        const status = proxyRes.statusCode || 500;
        try {
          const json = data ? JSON.parse(data) : {};
          console.log('파싱된 응답:', json);
          return res.status(status).json(json);
        } catch (e) {
          console.error('JSON 파싱 오류:', e);
          return res.status(status).send(data);
        }
      });
    });

    proxyReq.on('error', (err) => {
      console.error('비밀번호 초기화 proxy error:', err.message);
      console.error('에러 상세:', err);
      return res.status(502).json({ 
        status_code: 502, 
        error: `Upstream request failed: ${err.message}` 
      });
    });

    proxyReq.on('timeout', () => {
      console.error('외부 API 타임아웃');
      proxyReq.destroy();
      return res.status(504).json({ 
        status_code: 504, 
        error: 'Request timeout' 
      });
    });

    proxyReq.write(payload);
    proxyReq.end();
  } catch (error) {
    console.error('비밀번호 초기화 proxy handler error:', error);
    return res.status(500).json({ 
      status_code: 500, 
      error: `Internal server error: ${error.message}` 
    });
  }
});

// Serve static files from client directory
app.use((req, res, next) => {
  try {
    // URL 디코딩 오류를 포착하기 위한 미들웨어
    if (req.path) {
      // API 요청이 아닌 경우에만 URL 디코딩 시도 (/api 또는 /admin으로 시작하는 요청은 제외)
      if (!req.path.startsWith('/api') && !req.path.startsWith('/admin')) {
        // URL 디코딩 시도 전에 유효성 검사
        if (req.path.includes('%') && !/^[a-zA-Z0-9\-._~%]+$/.test(req.path)) {
          console.error('잘못된 URL 문자 포함:', req.path);
          return res.status(400).send('잘못된 URL 요청입니다');
        }
        decodeURIComponent(req.path);
      }
    }
    next();
  } catch (err) {
    console.error('URL 디코딩 오류:', err.message, 'URL:', req.originalUrl);
    
    // API 요청인 경우 JSON 응답
    if (req.path.startsWith('/api') || req.path.startsWith('/admin')) {
      return res.status(400).json({ 
        message: '잘못된 URL 요청입니다',
        error: err.message 
      });
    } 
    // 일반 요청인 경우 HTML 응답
    else {
      // 잘못된 URL 요청 시 index.html로 리다이렉트
      return res.redirect('/');
    }
  }
});

// 이미지 경로에 대한 특별 처리
app.use('/images', (req, res, next) => {
  // 이미지 파일이 없을 경우 404 대신 빈 응답 반환
  try {
    express.static(path.join(__dirname, '../client/images'))(req, res, (err) => {
      if (err) {
        console.log('이미지 파일 찾기 실패:', req.path);
        return res.status(204).send(); // 이미지가 없어도 오류 대신 빈 응답
      }
      next();
    });
  } catch (err) {
    console.error('이미지 처리 오류:', err.message);
    res.status(204).send();
  }
});

// 정적 파일 서빙 - API 경로는 제외
app.use((req, res, next) => {
  // /api 또는 /admin으로 시작하는 요청은 정적 파일로 처리하지 않음
  if (req.path.startsWith('/api') || req.path.startsWith('/admin')) {
    return next();
  }
  express.static(path.join(__dirname, '../client'))(req, res, next);
});

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) return res.status(401).json({ message: '인증 토큰이 필요합니다.' });
  
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: '유효하지 않은 토큰입니다.' });
    req.user = user;
    next();
  });
};

// Mock data
const mockUsers = [
  { id: 1, name: '홍길동', email: 'hong@example.com', department: '인사팀', role: '관리자', lastLogin: '2023-01-01' },
  { id: 2, name: '김철수', email: 'kim@example.com', department: '영업팀', role: '사용자', lastLogin: '2023-01-02' },
  { id: 3, name: '이영희', email: 'lee@example.com', department: '개발팀', role: '사용자', lastLogin: '2023-01-03' }
];

const mockConversations = [
  { id: 1, userId: 1, userName: '홍길동', category: '문의', department: '인사팀', startTime: '2023-01-01T10:00:00', endTime: '2023-01-01T10:15:00', messages: 10 },
  { id: 2, userId: 2, userName: '김철수', category: '불만', department: '영업팀', startTime: '2023-01-02T11:00:00', endTime: '2023-01-02T11:20:00', messages: 15 },
  { id: 3, userId: 3, userName: '이영희', category: '제안', department: '개발팀', startTime: '2023-01-03T12:00:00', endTime: '2023-01-03T12:10:00', messages: 8 }
];

const mockDashboardData = {
  totalUsers: 150,
  todayConversations: 25,
  activeUsers: 85
};

// Routes
// Auth routes
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    // 데이터베이스에서 사용자 정보 조회
    const db = require('./config/db');
    const result = await db.query(
      'SELECT user_id, name, dept, admin_role FROM "aiagent_schema"."user" WHERE user_id = $1',
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        status_code: 401,
        admin_role: null,
        error: '아이디 또는 비밀번호가 올바르지 않습니다.'
      });
    }

    const user = result.rows[0];
    console.log('로그인 시도:', { username, admin_role: user.admin_role });

    // 실제 환경에서는 비밀번호 해시 검증 필요
    // 현재는 간단히 사용자 존재 여부만 확인
    return res.json({
      status_code: 200,
      admin_role: user.admin_role,
      error: null
    });

  } catch (error) {
    console.error('로그인 처리 오류:', error);
    return res.status(500).json({
      status_code: 500,
      admin_role: null,
      error: '서버 오류가 발생했습니다.'
    });
  }
});

// Dashboard routes는 이제 별도 라우터에서 처리됩니다.

// User routes
app.get('/api/users', authenticateToken, (req, res) => {
  const { page = 1, limit = 10, search = '' } = req.query;
  
  let filteredUsers = [...mockUsers];
  if (search) {
    filteredUsers = filteredUsers.filter(user => 
      user.name.includes(search) || 
      user.email.includes(search) || 
      user.department.includes(search)
    );
  }
  
  const startIndex = (page - 1) * limit;
  const endIndex = page * limit;
  const paginatedUsers = filteredUsers.slice(startIndex, endIndex);
  
  res.json({
    users: paginatedUsers,
    total: filteredUsers.length,
    page: parseInt(page),
    totalPages: Math.ceil(filteredUsers.length / limit)
  });
});

app.get('/api/users/:id', authenticateToken, (req, res) => {
  const user = mockUsers.find(u => u.id === parseInt(req.params.id));
  
  if (!user) {
    return res.status(404).json({ message: '사용자를 찾을 수 없습니다.' });
  }
  
  res.json(user);
});

app.post('/api/users', authenticateToken, (req, res) => {
  const newUser = {
    id: mockUsers.length + 1,
    ...req.body,
    lastLogin: new Date().toISOString()
  };
  
  mockUsers.push(newUser);
  res.status(201).json(newUser);
});

app.put('/api/users/:id', authenticateToken, (req, res) => {
  const userIndex = mockUsers.findIndex(u => u.id === parseInt(req.params.id));
  
  if (userIndex === -1) {
    return res.status(404).json({ message: '사용자를 찾을 수 없습니다.' });
  }
  
  mockUsers[userIndex] = { ...mockUsers[userIndex], ...req.body };
  res.json(mockUsers[userIndex]);
});

app.delete('/api/users/:id', authenticateToken, (req, res) => {
  const userIndex = mockUsers.findIndex(u => u.id === parseInt(req.params.id));
  
  if (userIndex === -1) {
    return res.status(404).json({ message: '사용자를 찾을 수 없습니다.' });
  }
  
  const deletedUser = mockUsers.splice(userIndex, 1)[0];
  res.json({ message: '사용자가 삭제되었습니다.', user: deletedUser });
});

// Conversation routes
app.get('/api/conversations', authenticateToken, (req, res) => {
  const { page = 1, limit = 10, userName, category, department, is_deleted } = req.query;
  
  let filteredConversations = [...mockConversations];
  
  if (is_deleted === 'true') {
    filteredConversations = filteredConversations.filter(conv => conv.is_deleted === true);
  } else if (is_deleted === 'false') {
    filteredConversations = filteredConversations.filter(conv => !conv.is_deleted);
  }
  
  if (userName) {
    filteredConversations = filteredConversations.filter(conv => 
      conv.userName.includes(userName)
    );
  }
  
  if (category) {
    filteredConversations = filteredConversations.filter(conv => 
      conv.category === category
    );
  }
  
  if (department) {
    filteredConversations = filteredConversations.filter(conv => 
      conv.department === department
    );
  }
  
  const startIndex = (page - 1) * limit;
  const endIndex = page * limit;
  const paginatedConversations = filteredConversations.slice(startIndex, endIndex);
  
  res.json({
    conversations: paginatedConversations,
    total: filteredConversations.length,
    page: parseInt(page),
    totalPages: Math.ceil(filteredConversations.length / limit)
  });
});

app.get('/api/conversations/:id', authenticateToken, (req, res) => {
  const conversation = mockConversations.find(c => c.id === parseInt(req.params.id));
  
  if (!conversation) {
    return res.status(404).json({ message: '대화를 찾을 수 없습니다.' });
  }
  
  res.json(conversation);
});

// Report routes
app.get('/api/reports', authenticateToken, (req, res) => {
  const { type, date } = req.query;
  
  // 여기서는 간단한 예시 데이터만 반환
  const reportData = {
    type,
    date,
    data: {
      labels: ['1월', '2월', '3월', '4월', '5월', '6월'],
      values: [65, 59, 80, 81, 56, 55]
    }
  };
  
  res.json(reportData);
});

// Serve HTML files
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/index.html'));
});

app.get('/pages/:page', (req, res) => {
  try {
    let page = decodeURIComponent(req.params.page);
    
    // 안전하지 않은 문자 필터링 (URL 인코딩된 % 제외)
    if (page.includes('<') || page.includes('>') || page.includes('..') || page.includes('script')) {
      return res.status(400).json({ 
        message: '잘못된 페이지 요청입니다.',
        error: 'Invalid page parameter' 
      });
    }
    
    // .html 확장자가 없는 경우 자동으로 추가
    if (!page.endsWith('.html')) {
      page = page + '.html';
    }
    
    const filePath = path.join(__dirname, '../client/pages', page);
    
    // 파일 존재 확인
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ 
        message: '요청한 페이지를 찾을 수 없습니다.',
        error: 'Page not found' 
      });
    }
    
    res.sendFile(filePath);
  } catch (error) {
    console.error('페이지 요청 처리 오류:', error);
    return res.status(400).json({ 
      message: '잘못된 URL 형식입니다.',
      error: error.message 
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('서버 오류:', err.name, err.message);
  
  // URI 디코딩 오류 처리
  if (err instanceof URIError) {
    return res.status(400).json({ 
      message: '잘못된 URL 형식입니다.',
      error: err.message 
    });
  }
  
  // 다른 종류의 오류 처리
  if (err.status) {
    return res.status(err.status).json({ 
      message: err.message || '요청을 처리할 수 없습니다.' 
    });
  }
  
  // 기본 서버 오류
  res.status(500).json({ 
    message: '서버 오류가 발생했습니다.', 
    error: process.env.NODE_ENV === 'production' ? null : err.message
  });
});

// Catch-all route for client-side routing
app.get('*', (req, res) => {
  // API 경로가 아닌 경우에만 index.html로 라우팅
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, '../client/index.html'));
  } else {
    res.status(404).json({ message: '요청한 API를 찾을 수 없습니다.' });
  }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n🚀 서버가 ${url} 에서 실행 중입니다.`);
  console.log(`🌐 외부 접속: http://[당신의_IP주소]:${PORT}`);
  console.log('\n✅ 등록된 API 라우트:');
  console.log('  - POST /api/admin/leave/approval (대리승인/반려) ⭐');
  console.log('\n📝 서버가 정상적으로 시작되었습니다.\n');
  
  // 브라우저 자동 열기 (Windows)
  const { exec } = require('child_process');
  const platform = process.platform;
  
  if (platform === 'win32') {
    // Windows
    exec(`start ${url}`, (error) => {
      if (error) {
        console.log('브라우저를 자동으로 열 수 없습니다. 수동으로 접속해주세요:', url);
      } else {
        console.log('브라우저가 자동으로 열렸습니다.');
      }
    });
  } else if (platform === 'darwin') {
    // macOS
    exec(`open ${url}`, (error) => {
      if (error) {
        console.log('브라우저를 자동으로 열 수 없습니다. 수동으로 접속해주세요:', url);
      }
    });
  } else {
    // Linux
    exec(`xdg-open ${url}`, (error) => {
      if (error) {
        console.log('브라우저를 자동으로 열 수 없습니다. 수동으로 접속해주세요:', url);
      }
    });
  }
});

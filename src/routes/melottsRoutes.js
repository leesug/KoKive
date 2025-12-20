/**
 * KoKive MeloTTS Routes
 * MeloTTS 음성 합성 API 엔드포인트
 */

const express = require('express');
const router = express.Router();
const http = require('http');

// MeloTTS 서비스 설정
const MELOTTS_HOST = '127.0.0.1';
const MELOTTS_PORT = 5555;

/**
 * MeloTTS 서비스에 요청을 보내는 헬퍼 함수
 */
function melottsRequest(method, path, body = null) {
    return new Promise((resolve, reject) => {
        const bodyStr = body ? JSON.stringify(body) : null;
        const options = {
            hostname: MELOTTS_HOST,
            port: MELOTTS_PORT,
            path: path,
            method: method,
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: 60000  // 60초 타임아웃 (TTS 생성에 시간이 걸릴 수 있음)
        };

        // Add Content-Length header for POST requests
        if (bodyStr) {
            options.headers['Content-Length'] = Buffer.byteLength(bodyStr, 'utf8');
        }

        const req = http.request(options, (res) => {
            const chunks = [];

            res.on('data', (chunk) => {
                chunks.push(chunk);
            });

            res.on('end', () => {
                const data = Buffer.concat(chunks);

                // JSON 응답인 경우
                if (res.headers['content-type'] && res.headers['content-type'].includes('application/json')) {
                    try {
                        resolve({
                            statusCode: res.statusCode,
                            headers: res.headers,
                            body: JSON.parse(data.toString('utf-8'))
                        });
                    } catch (e) {
                        resolve({
                            statusCode: res.statusCode,
                            headers: res.headers,
                            body: data.toString('utf-8')
                        });
                    }
                } else {
                    // 바이너리 응답 (오디오)
                    resolve({
                        statusCode: res.statusCode,
                        headers: res.headers,
                        body: data
                    });
                }
            });
        });

        req.on('error', (error) => {
            reject(error);
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });

        if (bodyStr) {
            req.write(bodyStr);
        }

        req.end();
    });
}

/**
 * GET /api/melotts/status
 * MeloTTS 서비스 상태 확인
 */
router.get('/status', async (req, res) => {
    try {
        const response = await melottsRequest('GET', '/status');

        if (response.statusCode === 200) {
            res.json(response.body);
        } else {
            res.status(response.statusCode).json({
                success: false,
                message: 'MeloTTS service error',
                status: 'error'
            });
        }
    } catch (error) {
        console.error('MeloTTS status check failed:', error.message);
        res.status(503).json({
            success: false,
            message: 'MeloTTS 서비스에 연결할 수 없습니다. 서비스가 실행 중인지 확인하세요.',
            status: 'unavailable',
            error: error.message
        });
    }
});

/**
 * POST /api/melotts/synthesize
 * 텍스트를 음성으로 변환
 *
 * Body:
 *   - text: string (필수) - 변환할 텍스트
 *   - voice: string - 목소리 선택 (KR, EN-US, EN-BR, EN_NEWEST, JP, ZH)
 *   - speed: number - 말하기 속도 (0.5 ~ 2.0)
 *   - tone: string - 톤 설정 (현재 미지원)
 *   - emotion_intensity: number - 감정 강도 (현재 미지원)
 *   - sample_rate: number - 샘플레이트 (22050 또는 44100)
 */
router.post('/synthesize', async (req, res) => {
    try {
        const {
            text,
            voice = 'KR',
            speed = 1.0,
            tone = 'neutral',
            emotion_intensity = 50,
            sample_rate = 44100
        } = req.body;

        if (!text || text.trim().length === 0) {
            return res.status(400).json({
                success: false,
                message: '텍스트가 필요합니다.'
            });
        }

        // 텍스트 길이 제한 (약 10분 분량)
        if (text.length > 5000) {
            return res.status(400).json({
                success: false,
                message: '텍스트가 너무 깁니다. 5000자 이하로 입력해주세요.'
            });
        }

        console.log(`MeloTTS synthesize request: voice=${voice}, speed=${speed}, text_length=${text.length}`);

        const response = await melottsRequest('POST', '/synthesize', {
            text: text,
            voice: voice,
            speed: parseFloat(speed),
            sample_rate: parseInt(sample_rate)
        });

        if (response.statusCode === 200 && response.headers['content-type']?.includes('audio/wav')) {
            // 오디오 파일 응답
            res.set({
                'Content-Type': 'audio/wav',
                'Content-Length': response.body.length,
                'Cache-Control': 'no-cache'
            });
            res.send(response.body);
        } else {
            // 에러 응답
            const errorBody = typeof response.body === 'object' ? response.body : { message: response.body };
            res.status(response.statusCode).json({
                success: false,
                message: errorBody.message || 'TTS 생성 실패',
                ...errorBody
            });
        }
    } catch (error) {
        console.error('MeloTTS synthesize failed:', error.message);
        res.status(503).json({
            success: false,
            message: 'MeloTTS 서비스에 연결할 수 없습니다.',
            error: error.message
        });
    }
});

/**
 * GET /api/melotts/voices
 * 사용 가능한 목소리 목록
 */
router.get('/voices', (req, res) => {
    res.json({
        success: true,
        voices: [
            { id: 'KR', name: '한국어', language: 'Korean' },
            { id: 'EN-US', name: '영어 (미국)', language: 'English (US)' },
            { id: 'EN-BR', name: '영어 (영국)', language: 'English (UK)' },
            { id: 'EN_NEWEST', name: '영어 (최신)', language: 'English (Newest)' },
            { id: 'JP', name: '일본어', language: 'Japanese' },
            { id: 'ZH', name: '중국어', language: 'Chinese' }
        ]
    });
});

module.exports = router;

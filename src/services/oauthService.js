/**
 * KoKive OAuth Service
 * Google, GitHub OAuth 인증 처리
 */

const axios = require('axios');

/**
 * OAuth 설정을 런타임에 가져옵니다.
 * 모듈 로드 시점이 아닌 함수 호출 시점에 환경 변수를 읽습니다.
 */
function getOAuthConfig(provider) {
    const configs = {
        google: {
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            redirectUri: process.env.GOOGLE_REDIRECT_URI || 'https://kokive.com/api/v1/auth/oauth/google/callback',
            authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
            tokenUrl: 'https://oauth2.googleapis.com/token',
            userInfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
            scope: 'email profile'
        },
        github: {
            clientId: process.env.GITHUB_CLIENT_ID,
            clientSecret: process.env.GITHUB_CLIENT_SECRET,
            redirectUri: process.env.GITHUB_REDIRECT_URI || 'https://kokive.com/api/v1/auth/oauth/github/callback',
            authUrl: 'https://github.com/login/oauth/authorize',
            tokenUrl: 'https://github.com/login/oauth/access_token',
            userInfoUrl: 'https://api.github.com/user',
            emailUrl: 'https://api.github.com/user/emails',
            scope: 'user:email'
        }
    };

    return configs[provider];
}

/**
 * OAuth 인증 URL 생성
 */
function getAuthUrl(provider, state) {
    const config = getOAuthConfig(provider);
    if (!config) {
        throw new Error(`지원하지 않는 OAuth 제공자: ${provider}`);
    }

    // 환경 변수 로드 확인
    if (!config.clientId) {
        console.error(`OAuth ${provider} clientId is not configured. Check environment variables.`);
        throw new Error(`OAuth ${provider} 설정이 올바르지 않습니다. 관리자에게 문의하세요.`);
    }

    const params = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        response_type: 'code',
        scope: config.scope,
        state: state || ''
    });

    // Google은 access_type 필요
    if (provider === 'google') {
        params.append('access_type', 'offline');
        params.append('prompt', 'consent');
    }

    return `${config.authUrl}?${params.toString()}`;
}

/**
 * Authorization code로 access token 교환
 */
async function getAccessToken(provider, code) {
    const config = getOAuthConfig(provider);
    if (!config) {
        throw new Error(`지원하지 않는 OAuth 제공자: ${provider}`);
    }

    const params = {
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code: code,
        redirect_uri: config.redirectUri
    };

    if (provider === 'google') {
        params.grant_type = 'authorization_code';
    }

    const headers = {
        'Content-Type': 'application/x-www-form-urlencoded'
    };

    if (provider === 'github') {
        headers['Accept'] = 'application/json';
    }

    const response = await axios.post(config.tokenUrl, new URLSearchParams(params).toString(), { headers });

    if (provider === 'github' && response.data.error) {
        throw new Error(response.data.error_description || response.data.error);
    }

    return response.data.access_token;
}

/**
 * Access token으로 사용자 정보 조회
 */
async function getUserInfo(provider, accessToken) {
    const config = getOAuthConfig(provider);
    if (!config) {
        throw new Error(`지원하지 않는 OAuth 제공자: ${provider}`);
    }

    const headers = {
        'Authorization': `Bearer ${accessToken}`
    };

    if (provider === 'github') {
        headers['Accept'] = 'application/vnd.github.v3+json';
    }

    const response = await axios.get(config.userInfoUrl, { headers });
    const userData = response.data;

    // GitHub는 이메일을 별도 API로 조회해야 할 수 있음
    if (provider === 'github' && !userData.email) {
        try {
            const emailResponse = await axios.get(config.emailUrl, { headers });
            const primaryEmail = emailResponse.data.find(e => e.primary && e.verified);
            if (primaryEmail) {
                userData.email = primaryEmail.email;
            }
        } catch (err) {
            console.error('GitHub 이메일 조회 실패:', err.message);
        }
    }

    // 통일된 형식으로 반환
    return {
        provider,
        id: String(userData.id),
        email: userData.email,
        name: userData.name || userData.login || '',
        picture: provider === 'google' ? userData.picture : userData.avatar_url
    };
}

module.exports = {
    getOAuthConfig,
    getAuthUrl,
    getAccessToken,
    getUserInfo
};

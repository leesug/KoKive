/**
 * KoKive Admin Controller
 * 관리자 ?�?�보??�??�스??관�?(FR-015)
 */

const { query, queryOne, paginate, update, remove, insert } = require('../config/database');
const { HTTP_STATUS, ERROR_CODES, USER_ROLES, PROCESSING_STATUS } = require('../config/constants');

// ==========================================
// ?�?�보??
// ==========================================

/**
 * 관리자 ?�?�보???�계
 */
exports.getDashboardStats = async (req, res, next) => {
    try {
        // 병렬�??�계 조회
        const [
            paperStats,
            userStats,
            communityStats,
            shortsStats,
            recentPapers,
            processingQueue
        ] = await Promise.all([
            // ?�문 ?�계
            queryOne(`
                SELECT
                    COUNT(*) as total,
                    SUM(CASE WHEN processing_status = 'completed' THEN 1 ELSE 0 END) as processed,
                    SUM(CASE WHEN processing_status = 'pending' THEN 1 ELSE 0 END) as pending,
                    SUM(CASE WHEN processing_status = 'failed' THEN 1 ELSE 0 END) as failed,
                    SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) as this_week
                FROM papers
            `),
            // ?�용???�계
            queryOne(`
                SELECT
                    COUNT(*) as total,
                    SUM(CASE WHEN role = 'pro' THEN 1 ELSE 0 END) as pro_users,
                    SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) as new_this_week
                FROM users WHERE is_active = TRUE
            `),
            // 커�??�티 ?�계
            queryOne(`
                SELECT
                    (SELECT COUNT(*) FROM questions) as total_questions,
                    (SELECT COUNT(*) FROM answers) as total_answers,
                    (SELECT COUNT(*) FROM questions WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)) as questions_this_week
            `),
            // ?�츠 ?�계
            queryOne(`
                SELECT
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) as published,
                    SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as drafts
                FROM shorts
            `),
            // 최근 ?�문 5�?
            query(`
                SELECT id, arxiv_id, title_ko, primary_category, processing_status, created_at
                FROM papers ORDER BY created_at DESC LIMIT 5
            `),
            // 처리 ?��???
            query(`
                SELECT id, job_type, status, created_at
                FROM job_queue
                WHERE status IN ('pending', 'processing')
                ORDER BY created_at ASC LIMIT 10
            `)
        ]);

        res.json({
            success: true,
            data: {
                papers: {
                    total: paperStats.total || 0,
                    processed: paperStats.processed || 0,
                    pending: paperStats.pending || 0,
                    failed: paperStats.failed || 0,
                    thisWeek: paperStats.this_week || 0
                },
                users: {
                    total: userStats.total || 0,
                    proUsers: userStats.pro_users || 0,
                    newThisWeek: userStats.new_this_week || 0
                },
                community: {
                    totalQuestions: communityStats.total_questions || 0,
                    totalAnswers: communityStats.total_answers || 0,
                    questionsThisWeek: communityStats.questions_this_week || 0
                },
                shorts: {
                    total: shortsStats.total || 0,
                    published: shortsStats.published || 0,
                    drafts: shortsStats.drafts || 0
                },
                recentPapers: recentPapers.map(p => ({
                    id: p.id,
                    arxivId: p.arxiv_id,
                    title: p.title_ko,
                    category: p.primary_category,
                    status: p.processing_status,
                    createdAt: p.created_at
                })),
                processingQueue: processingQueue.map(j => ({
                    id: j.id,
                    type: j.job_type,
                    status: j.status,
                    createdAt: j.created_at
                }))
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * ?�?�보???�계 카드??간단 ?�계
 */
exports.getSimpleStats = async (req, res, next) => {
    try {
        // �?쿼리�?개별?�으�??�행?�여 ?�나가 ?�패?�도 ?�른 것�? ?�공?�도�???
        let paperStats = { total: 0, today: 0 };
        let userStats = { total: 0, today: 0 };
        let shortsStats = { total: 0 };
        let apiStats = { today_calls: 0 };

        try {
            paperStats = await queryOne(`
                SELECT
                    COUNT(*) as total,
                    SUM(CASE WHEN DATE(created_at) = CURDATE() THEN 1 ELSE 0 END) as today
                FROM papers
            `) || { total: 0, today: 0 };
        } catch (e) { console.error('Paper stats error:', e.message); }

        try {
            userStats = await queryOne(`
                SELECT
                    COUNT(*) as total,
                    SUM(CASE WHEN DATE(created_at) = CURDATE() THEN 1 ELSE 0 END) as today
                FROM users WHERE is_active = TRUE
            `) || { total: 0, today: 0 };
        } catch (e) { console.error('User stats error:', e.message); }

        try {
            shortsStats = await queryOne(`SELECT COUNT(*) as total FROM shorts`) || { total: 0 };
        } catch (e) { console.error('Shorts stats error:', e.message); }

        try {
            apiStats = await queryOne(`
                SELECT COUNT(*) as today_calls
                FROM api_usage_logs
                WHERE DATE(created_at) = CURDATE()
            `) || { today_calls: 0 };
        } catch (e) { console.error('API stats error:', e.message); }

        res.json({
            success: true,
            data: {
                totalPapers: paperStats?.total || 0,
                totalUsers: userStats?.total || 0,
                totalShorts: shortsStats?.total || 0,
                todayApiCalls: apiStats?.today_calls || 0,
                todayPapers: paperStats?.today || 0,
                todayUsers: userStats?.today || 0
            }
        });
    } catch (error) {
        next(error);
    }
};

// ==========================================
// ?�문 관�?
// ==========================================

/**
 * ?�문 목록 조회 (관리자)
 */
exports.getPapers = async (req, res, next) => {
    try {
        const {
            page = 1,
            limit = 20,
            status,
            category,
            search,
            sortBy = 'created_at',
            sortOrder = 'DESC'
        } = req.query;

        let whereClause = '1=1';
        const params = [];

        if (status) {
            whereClause += ' AND processing_status = ?';
            params.push(status);
        }

        if (category) {
            whereClause += ' AND primary_category = ?';
            params.push(category);
        }

        if (search) {
            whereClause += ' AND (title_ko LIKE ? OR title_en LIKE ? OR arxiv_id LIKE ?)';
            const searchPattern = '%' + search + '%';
            params.push(searchPattern, searchPattern, searchPattern);
        }

        const allowedSortFields = ['created_at', 'published_at', 'title_ko', 'processing_status'];
        const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'created_at';
        const order = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

        const result = await paginate(`
            SELECT
                p.id, p.arxiv_id, p.title_ko, p.title_en,
                p.primary_category, p.processing_status,
                p.published_at, p.created_at,
                (SELECT COUNT(*) FROM paper_ratings WHERE paper_id = p.id) as rating_count
            FROM papers p
            WHERE ${whereClause}
        `, params, {
            page: parseInt(page),
            limit: parseInt(limit),
            orderBy: 'p.' + sortField + ' ' + order
        });

        res.json({
            success: true,
            data: result.items.map(p => ({
                id: p.id,
                arxivId: p.arxiv_id,
                titleKo: p.title_ko,
                titleEn: p.title_en,
                category: p.primary_category,
                status: p.processing_status,
                ratingCount: p.rating_count,
                publishedAt: p.published_at,
                createdAt: p.created_at
            })),
            pagination: result.pagination
        });
    } catch (error) {
        next(error);
    }
};

/**
 * ?�문 처리 ?�태 변�?
 */
exports.updatePaperStatus = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (!Object.values(PROCESSING_STATUS).includes(status)) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json({
                success: false,
                error: { code: ERROR_CODES.VALIDATION_ERROR, message: '?�효?��? ?��? ?�태?�니??' }
            });
        }

        await update('papers', { processing_status: status }, 'id = ?', [id]);

        res.json({
            success: true,
            message: '?�문 ?�태가 변경되?�습?�다.'
        });
    } catch (error) {
        next(error);
    }
};

/**
 * ?�문 ?�처�??�청
 */
exports.reprocessPaper = async (req, res, next) => {
    try {
        const { id } = req.params;

        const paper = await queryOne('SELECT id, arxiv_id FROM papers WHERE id = ?', [id]);
        if (!paper) {
            return res.status(HTTP_STATUS.NOT_FOUND).json({
                success: false,
                error: { code: ERROR_CODES.NOT_FOUND, message: '?�문??찾을 ???�습?�다.' }
            });
        }

        // ?�태�?pending?�로 변경하�??�업 ?�에 추�?
        await update('papers', { processing_status: PROCESSING_STATUS.PENDING }, 'id = ?', [id]);

        await insert('job_queue', {
            job_type: 'ai_process',
            payload: JSON.stringify({ paperId: id, arxivId: paper.arxiv_id }),
            status: 'pending',
            priority: 5
        });

        res.json({
            success: true,
            message: '?�문 ?�처리�? ?�청?�었?�니??'
        });
    } catch (error) {
        next(error);
    }
};

/**
 * ?�문 ??��
 */
exports.deletePaper = async (req, res, next) => {
    try {
        const { id } = req.params;

        // 관???�이????�� (CASCADE ?�정???��?�?명시?�으�?
        await remove('papers', 'id = ?', [id]);

        res.json({
            success: true,
            message: '?�문????��?�었?�니??'
        });
    } catch (error) {
        next(error);
    }
};

// ==========================================
// ?�용??관�?
// ==========================================

/**
 * ?�용???�계
 */
exports.getUserStats = async (req, res, next) => {
    try {
        let stats = { total: 0, pro: 0, today: 0, active: 0 };

        try {
            const result = await queryOne(`
                SELECT
                    COUNT(*) as total,
                    SUM(CASE WHEN role = 'pro' OR role = 'admin' THEN 1 ELSE 0 END) as pro,
                    SUM(CASE WHEN DATE(created_at) = CURDATE() THEN 1 ELSE 0 END) as today,
                    SUM(CASE WHEN last_login_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) as active
                FROM users
                WHERE is_active = TRUE
            `);
            if (result) {
                stats = {
                    total: result.total || 0,
                    pro: result.pro || 0,
                    today: result.today || 0,
                    active: result.active || 0
                };
            }
        } catch (e) {
            console.error('User stats query error:', e.message);
        }

        res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        next(error);
    }
};

/**
 * ?�용??목록 조회
 */
exports.getUsers = async (req, res, next) => {
    try {
        const { page = 1, limit = 20, role, search, isActive } = req.query;

        let whereClause = '1=1';
        const params = [];

        if (role) {
            whereClause += ' AND role = ?';
            params.push(role);
        }

        if (isActive !== undefined) {
            whereClause += ' AND is_active = ?';
            params.push(isActive === 'true');
        }

        if (search) {
            whereClause += ' AND (email LIKE ? OR nickname LIKE ?)';
            const searchPattern = '%' + search + '%';
            params.push(searchPattern, searchPattern);
        }

        const result = await paginate(`
            SELECT
                u.id, u.email, u.nickname, u.role, u.is_active,
                u.created_at, u.last_login_at,
                (SELECT COUNT(*) FROM questions WHERE user_id = u.id) as question_count,
                (SELECT COUNT(*) FROM answers WHERE user_id = u.id) as answer_count
            FROM users u
            WHERE ${whereClause}
        `, params, {
            page: parseInt(page),
            limit: parseInt(limit),
            orderBy: 'u.created_at DESC'
        });

        res.json({
            success: true,
            data: {
                users: result.items.map(u => ({
                    id: u.id,
                    email: u.email,
                    nickname: u.nickname,
                    role: u.role,
                    plan: u.role === 'pro' || u.role === 'admin' ? 'pro' : 'free',
                    isActive: u.is_active,
                    questionCount: u.question_count,
                    answerCount: u.answer_count,
                    createdAt: u.created_at,
                    lastLoginAt: u.last_login_at
                })),
                pagination: result.pagination
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * ?�용???�세 조회
 */
exports.getUserById = async (req, res, next) => {
    try {
        const { id } = req.params;

        // plan 컬럼이 없을 수 있으므로 안전하게 조회
        let user;
        try {
            user = await queryOne(`
                SELECT id, email, nickname, role, plan, is_active, created_at, last_login_at
                FROM users WHERE id = ?
            `, [id]);
        } catch (e) {
            // plan 컬럼이 없는 경우 plan 없이 조회
            user = await queryOne(`
                SELECT id, email, nickname, role, is_active, created_at, last_login_at
                FROM users WHERE id = ?
            `, [id]);
        }

        if (!user) {
            return res.status(HTTP_STATUS.NOT_FOUND).json({
                success: false,
                error: { code: ERROR_CODES.NOT_FOUND, message: '사용자를 찾을 수 없습니다.' }
            });
        }

        // 뉴스레터 구독 여부 조회
        let newsletterSubscribed = false;
        try {
            const subscription = await queryOne(
                'SELECT id FROM newsletter_subscriptions WHERE user_id = ? AND is_active = TRUE',
                [id]
            );
            newsletterSubscribed = !!subscription;
        } catch (e) {
            // 테이블이 없는 경우 무시
        }

        // role 호환성: 기존 'pro', 'free' 값을 새로운 구조로 변환
        let userRole = user.role;
        let userPlan = user.plan || 'free';

        // 기존 구조 호환: role이 'pro'나 'free'인 경우 변환
        if (user.role === 'pro') {
            userRole = 'user';
            userPlan = 'pro';
        } else if (user.role === 'free') {
            userRole = 'user';
            userPlan = 'free';
        } else if (user.role === 'admin') {
            userRole = 'admin';
            userPlan = user.plan || 'pro';
        } else {
            userRole = user.role || 'user';
        }

        res.json({
            success: true,
            data: {
                id: user.id,
                email: user.email,
                nickname: user.nickname,
                role: userRole,
                plan: userPlan,
                isActive: user.is_active,
                createdAt: user.created_at,
                lastLoginAt: user.last_login_at,
                newsletterSubscribed: newsletterSubscribed
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * ?�용??추�?
 */
exports.createUser = async (req, res, next) => {
    try {
        const { email, nickname, password, role, plan, newsletterSubscribed } = req.body;

        if (!email || !password) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json({
                success: false,
                error: { code: ERROR_CODES.VALIDATION_ERROR, message: '이메일과 비밀번호는 필수입니다.' }
            });
        }

        // 중복 확인
        const existing = await queryOne('SELECT id FROM users WHERE email = ?', [email]);
        if (existing) {
            return res.status(HTTP_STATUS.CONFLICT).json({
                success: false,
                error: { code: ERROR_CODES.DUPLICATE_ENTRY, message: '이미 등록된 이메일입니다.' }
            });
        }

        const bcrypt = require('bcryptjs');
        const hashedPassword = await bcrypt.hash(password, 10);

        // role은 user 또는 admin만 허용
        const finalRole = role === 'admin' ? 'admin' : 'user';
        // plan은 free, basic, pro 중 하나
        const finalPlan = ['free', 'basic', 'pro'].includes(plan) ? plan : 'free';

        // 기본 사용자 데이터
        const userData = {
            email,
            nickname: nickname || email.split('@')[0],
            password: hashedPassword,
            role: finalRole,
            is_active: true
        };

        // plan 컬럼이 있으면 추가
        let userId;
        try {
            userData.plan = finalPlan;
            userId = await insert('users', userData);
        } catch (e) {
            // plan 컬럼이 없는 경우 plan 없이 시도
            delete userData.plan;
            userId = await insert('users', userData);
        }

        // 뉴스레터 구독 처리
        if (newsletterSubscribed) {
            try {
                await insert('newsletter_subscriptions', {
                    user_id: userId,
                    email: email,
                    subscription_type: 'weekly',
                    is_active: true,
                    verified_at: new Date()
                });
            } catch (e) {
                // 테이블이 없거나 이미 구독 중인 경우 무시
                console.log('Newsletter subscription error:', e.message);
            }
        }

        res.status(HTTP_STATUS.CREATED).json({
            success: true,
            message: '사용자가 추가되었습니다.',
            data: { userId }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * ?�용???�정
 */
exports.updateUser = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { email, nickname, role, plan, password, newsletterSubscribed } = req.body;

        const user = await queryOne('SELECT id, email FROM users WHERE id = ?', [id]);
        if (!user) {
            return res.status(HTTP_STATUS.NOT_FOUND).json({
                success: false,
                error: { code: ERROR_CODES.NOT_FOUND, message: '사용자를 찾을 수 없습니다.' }
            });
        }

        const updateData = {};
        if (email) updateData.email = email;
        if (nickname !== undefined) updateData.nickname = nickname;

        // DB의 role ENUM: 'free', 'pro', 'admin'
        // 프론트에서는 role(user/admin)과 plan(free/basic/pro)을 분리해서 보냄
        // DB에는 role 필드 하나에 저장 (free=일반+Free플랜, pro=일반+Pro플랜, admin=관리자)
        if (role === 'admin') {
            updateData.role = 'admin';
        } else if (plan) {
            // 일반 사용자는 plan에 따라 role 설정
            // basic 플랜은 DB에 없으므로 free로 저장
            updateData.role = (plan === 'pro') ? 'pro' : 'free';
        } else if (role === 'user') {
            // role만 user로 변경되고 plan이 없는 경우
            updateData.role = 'free';
        }

        if (password) {
            const bcrypt = require('bcryptjs');
            updateData.password = await bcrypt.hash(password, 10);
        }

        if (Object.keys(updateData).length > 0) {
            try {
                await update('users', updateData, { id });
            } catch (e) {
                console.error('User update error:', e.message, e.code);
                // plan 컬럼이 없으면 plan 없이 다시 시도 (Unknown column 'plan' 에러)
                if (updateData.plan !== undefined && (
                    (e.message && (e.message.includes('plan') || e.message.includes('Unknown column'))) ||
                    e.code === 'ER_BAD_FIELD_ERROR'
                )) {
                    console.log('Retrying without plan column...');
                    delete updateData.plan;
                    if (Object.keys(updateData).length > 0) {
                        await update('users', updateData, { id });
                    }
                } else {
                    throw e;
                }
            }
        }

        // 뉴스레터 구독 상태 변경
        if (newsletterSubscribed !== undefined) {
            const userEmail = email || user.email;
            try {
                const existingSub = await queryOne(
                    'SELECT id FROM newsletter_subscriptions WHERE user_id = ? OR email = ?',
                    [id, userEmail]
                );

                if (newsletterSubscribed && !existingSub) {
                    // 구독 추가
                    await insert('newsletter_subscriptions', {
                        user_id: id,
                        email: userEmail,
                        subscription_type: 'weekly',
                        is_active: true,
                        verified_at: new Date()
                    });
                } else if (!newsletterSubscribed && existingSub) {
                    // 구독 해지
                    await update('newsletter_subscriptions',
                        { is_active: false, unsubscribed_at: new Date() },
                        { id: existingSub.id }
                    );
                } else if (newsletterSubscribed && existingSub) {
                    // 구독 재활성화
                    await update('newsletter_subscriptions',
                        { is_active: true, unsubscribed_at: null },
                        { id: existingSub.id }
                    );
                }
            } catch (e) {
                console.log('Newsletter subscription update error:', e.message);
            }
        }

        res.json({
            success: true,
            message: '사용자 정보가 수정되었습니다.'
        });
    } catch (error) {
        next(error);
    }
};

/**
 * ?�용????��
 */
exports.deleteUser = async (req, res, next) => {
    try {
        const { id } = req.params;

        // ?�기 ?�신?� ??�� 불�?
        if (req.user && req.user.id === parseInt(id)) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json({
                success: false,
                error: { code: ERROR_CODES.VALIDATION_ERROR, message: '?�기 ?�신?� ??��?????�습?�다.' }
            });
        }

        const user = await queryOne('SELECT role FROM users WHERE id = ?', [id]);
        if (!user) {
            return res.status(HTTP_STATUS.NOT_FOUND).json({
                success: false,
                error: { code: ERROR_CODES.NOT_FOUND, message: '?�용?��? 찾을 ???�습?�다.' }
            });
        }

        // 관리자????�� 불�?
        if (user.role === 'admin') {
            return res.status(HTTP_STATUS.FORBIDDEN).json({
                success: false,
                error: { code: ERROR_CODES.FORBIDDEN, message: '관리자????��?????�습?�다.' }
            });
        }

        await remove('users', { id });

        res.json({
            success: true,
            message: '?�용?��? ??��?�었?�니??'
        });
    } catch (error) {
        next(error);
    }
};

/**
 * ?�용????�� 변�?
 */
exports.updateUserRole = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { role } = req.body;

        if (!Object.values(USER_ROLES).includes(role)) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json({
                success: false,
                error: { code: ERROR_CODES.VALIDATION_ERROR, message: '?�효?��? ?��? ??��?�니??' }
            });
        }

        await update('users', { role }, 'id = ?', [id]);

        res.json({
            success: true,
            message: '?�용????��??변경되?�습?�다.'
        });
    } catch (error) {
        next(error);
    }
};

/**
 * ?�용???�성??비활?�화
 */
exports.toggleUserStatus = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { isActive } = req.body;

        await update('users', { is_active: isActive }, 'id = ?', [id]);

        res.json({
            success: true,
            message: isActive ? '?�용?��? ?�성?�되?�습?�다.' : '?�용?��? 비활?�화?�었?�니??'
        });
    } catch (error) {
        next(error);
    }
};

// ==========================================
// ?�문 카테고리 조회
// ==========================================

/**
 * ?�문 카테고리 목록 (DB?�서 ?�적 조회)
 */
exports.getPaperCategories = async (req, res, next) => {
    try {
        // ?�문 ?�이블에???�제 ?�용??카테고리 조회
        const categories = await query(`
            SELECT DISTINCT primary_category as category, COUNT(*) as count
            FROM papers
            WHERE primary_category IS NOT NULL AND primary_category != ''
            GROUP BY primary_category
            ORDER BY count DESC
        `);

        // arXiv 카테고리 ?�름 매핑
        const arxivCategoryNames = {
            'cs.AI': 'AI (?�공지??',
            'cs.CL': 'CL (?�연?�처�?',
            'cs.CV': 'CV (컴퓨?�비??',
            'cs.LG': 'LG (기계?�습)',
            'cs.NE': 'NE (?�경�?진화)',
            'cs.IR': 'IR (?�보검??',
            'cs.HC': 'HC (HCI)',
            'cs.RO': 'RO (로보?�스)',
            'cs.CR': 'CR (보안)',
            'cs.SE': 'SE (?�프?�웨??',
            'cs.DC': 'DC (분산컴퓨??',
            'cs.DS': 'DS (?�이?�구�?',
            'cs.DB': 'DB (?�이?�베?�스)',
            'cs.GT': 'GT (게임?�론)',
            'cs.MA': 'MA (멀?�에?�전??',
            'cs.MM': 'MM (멀?��??�어)',
            'cs.PL': 'PL (?�로그래밍언??',
            'cs.SD': 'SD (?�운??',
            'stat.ML': 'ML (?�계/ML)',
            'stat.TH': 'TH (?�계?�론)',
            'eess.AS': 'AS (?�디???�성)',
            'eess.IV': 'IV (?��?지/비디??',
            'math.OC': 'OC (최적??',
            'q-bio.NC': 'NC (?�경계산)'
        };

        res.json({
            success: true,
            data: {
                categories: categories.map(c => ({
                    value: c.category,
                    label: arxivCategoryNames[c.category] || c.category,
                    count: c.count
                }))
            }
        });
    } catch (error) {
        next(error);
    }
};

// ==========================================
// ?�어 ?�전 관�?
// ==========================================

/**
 * ?�어 목록 조회 (관리자)
 */
exports.getTerms = async (req, res, next) => {
    try {
        const { page = 1, limit = 20, search, category } = req.query;

        let whereClause = '1=1';
        const params = [];

        if (search) {
            whereClause += ' AND (term_en LIKE ? OR term_ko LIKE ?)';
            const searchPattern = '%' + search + '%';
            params.push(searchPattern, searchPattern);
        }

        if (category) {
            whereClause += ' AND category = ?';
            params.push(category);
        }

        const result = await paginate(`
            SELECT
                t.id, t.term_en, t.term_ko, t.definition_ko,
                t.category, t.created_at, t.updated_at,
                (SELECT COUNT(*) FROM paper_terms WHERE term_id = t.id) as usage_count
            FROM terms t
            WHERE ${whereClause}
        `, params, {
            page: parseInt(page),
            limit: parseInt(limit),
            orderBy: 't.term_en ASC'
        });

        res.json({
            success: true,
            data: result.items.map(t => ({
                id: t.id,
                termEn: t.term_en,
                termKo: t.term_ko,
                definitionKo: t.definition_ko,
                category: t.category,
                usageCount: t.usage_count,
                createdAt: t.created_at,
                updatedAt: t.updated_at
            })),
            pagination: result.pagination
        });
    } catch (error) {
        next(error);
    }
};

/**
 * ?�어 카테고리 목록 (?�문 + ?�어 카테고리 ?�합)
 */
exports.getTermCategories = async (req, res, next) => {
    try {
        // ?�어 ?�이블의 카테고리
        const termCategories = await query(`
            SELECT DISTINCT category, COUNT(*) as count
            FROM terms
            WHERE category IS NOT NULL AND category != ''
            GROUP BY category
            ORDER BY count DESC
        `);

        // ?�문 ?�이블의 카테고리
        const paperCategories = await query(`
            SELECT DISTINCT primary_category as category, COUNT(*) as count
            FROM papers
            WHERE primary_category IS NOT NULL
            GROUP BY primary_category
            ORDER BY count DESC
            LIMIT 30
        `);

        // arXiv 카테고리 ?�름 매핑
        const arxivCategoryNames = {
            'cs.AI': 'AI (?�공지??',
            'cs.CL': 'CL (?�연?�처�?',
            'cs.CV': 'CV (컴퓨?�비??',
            'cs.LG': 'LG (기계?�습)',
            'cs.NE': 'NE (?�경�?진화)',
            'cs.IR': 'IR (?�보검??',
            'cs.HC': 'HC (HCI)',
            'cs.RO': 'RO (로보?�스)',
            'cs.CR': 'CR (보안)',
            'cs.SE': 'SE (?�프?�웨??',
            'stat.ML': 'ML (?�계/ML)'
        };

        // ?�어 카테고리 ?�름 매핑
        const termCategoryNames = {
            'algorithm': '?�고리즘',
            'architecture': '?�키?�처',
            'model': '모델',
            'technique': '기법',
            'paradigm': '?�러?�임',
            'auto_extracted': '?�동추출'
        };

        res.json({
            success: true,
            data: {
                termCategories: termCategories.map(c => ({
                    value: c.category,
                    label: termCategoryNames[c.category] || c.category,
                    count: c.count
                })),
                paperCategories: paperCategories.map(c => ({
                    value: c.category,
                    label: arxivCategoryNames[c.category] || c.category,
                    count: c.count
                }))
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * ?�어 ?�세 조회
 */
exports.getTermById = async (req, res, next) => {
    try {
        const { id } = req.params;

        const term = await queryOne(`
            SELECT id, term_en, term_ko, definition_ko, category,
                   related_terms, example_sentence, created_at, updated_at
            FROM terms WHERE id = ?
        `, [id]);

        if (!term) {
            return res.status(HTTP_STATUS.NOT_FOUND).json({
                success: false,
                error: { code: ERROR_CODES.NOT_FOUND, message: '?�어�?찾을 ???�습?�다.' }
            });
        }

        res.json({
            success: true,
            data: {
                id: term.id,
                termEn: term.term_en,
                termKo: term.term_ko,
                definitionKo: term.definition_ko,
                category: term.category,
                relatedTerms: term.related_terms ? JSON.parse(term.related_terms) : [],
                exampleSentence: term.example_sentence,
                createdAt: term.created_at,
                updatedAt: term.updated_at
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * ?�어 추�?
 */
exports.createTerm = async (req, res, next) => {
    try {
        const { termEn, termKo, definitionKo, category, relatedTerms, exampleSentence } = req.body;

        // 중복 ?�인
        const existing = await queryOne('SELECT id FROM terms WHERE term_en = ?', [termEn]);
        if (existing) {
            return res.status(HTTP_STATUS.CONFLICT).json({
                success: false,
                error: { code: ERROR_CODES.DUPLICATE_ENTRY, message: '?��? ?�록???�어?�니??' }
            });
        }

        const termId = await insert('terms', {
            term_en: termEn,
            term_ko: termKo,
            definition_ko: definitionKo,
            category: category || 'general',
            related_terms: relatedTerms ? JSON.stringify(relatedTerms) : null,
            example_sentence: exampleSentence || null
        });

        res.status(HTTP_STATUS.CREATED).json({
            success: true,
            message: '?�어가 추�??�었?�니??',
            data: { termId }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * ?�어 ?�정
 */
exports.updateTerm = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { termEn, termKo, definitionKo, category, relatedTerms, exampleSentence } = req.body;

        const updateData = {};
        if (termEn) updateData.term_en = termEn;
        if (termKo) updateData.term_ko = termKo;
        if (definitionKo) updateData.definition_ko = definitionKo;
        if (category) updateData.category = category;
        if (relatedTerms) updateData.related_terms = JSON.stringify(relatedTerms);
        if (exampleSentence !== undefined) updateData.example_sentence = exampleSentence;

        await update('terms', updateData, 'id = ?', [id]);

        res.json({
            success: true,
            message: '?�어가 ?�정?�었?�니??'
        });
    } catch (error) {
        next(error);
    }
};

/**
 * ?�어 ??��
 */
exports.deleteTerm = async (req, res, next) => {
    try {
        const { id } = req.params;

        await remove('terms', 'id = ?', [id]);

        res.json({
            success: true,
            message: '?�어가 ??��?�었?�니??'
        });
    } catch (error) {
        next(error);
    }
};

// ==========================================
// Q&A ?�고 관�?
// ==========================================

/**
 * ?�고??Q&A 목록
 */
exports.getReportedContent = async (req, res, next) => {
    try {
        // ?�고 기능?� votes ?�이블의 ?�별 ?�?�으�??�장 가??
        // ?�재????? ?�수??콘텐�?조회�??��?
        const [lowScoreQuestions, lowScoreAnswers] = await Promise.all([
            query(`
                SELECT q.id, q.title, q.user_id, u.nickname, q.created_at,
                    (SELECT COALESCE(SUM(value), 0) FROM votes WHERE target_type = 'question' AND target_id = q.id) as score
                FROM questions q
                JOIN users u ON q.user_id = u.id
                HAVING score < -3
                ORDER BY score ASC
                LIMIT 20
            `),
            query(`
                SELECT a.id, a.content, a.user_id, u.nickname, a.created_at,
                    (SELECT COALESCE(SUM(value), 0) FROM votes WHERE target_type = 'answer' AND target_id = a.id) as score
                FROM answers a
                JOIN users u ON a.user_id = u.id
                HAVING score < -3
                ORDER BY score ASC
                LIMIT 20
            `)
        ]);

        res.json({
            success: true,
            data: {
                questions: lowScoreQuestions,
                answers: lowScoreAnswers
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Q&A 콘텐�???��
 */
exports.deleteContent = async (req, res, next) => {
    try {
        const { type, id } = req.params;

        if (type === 'question') {
            await remove('questions', 'id = ?', [id]);
        } else if (type === 'answer') {
            await remove('answers', 'id = ?', [id]);
        } else {
            return res.status(HTTP_STATUS.BAD_REQUEST).json({
                success: false,
                error: { code: ERROR_CODES.VALIDATION_ERROR, message: '?�효?��? ?��? 콘텐�??�?�입?�다.' }
            });
        }

        res.json({
            success: true,
            message: '콘텐츠�? ??��?�었?�니??'
        });
    } catch (error) {
        next(error);
    }
};

// ==========================================
// ?�스???�정
// ==========================================

/**
 * ?�스???�정 조회
 */


// ==========================================
// ?�츠 API ?�정
// ==========================================

/**
 * ?�츠 API ?�정 조회
 */
exports.getShortsSettings = async (req, res, next) => {
    try {
        const settings = await queryOne(
            "SELECT setting_value FROM system_settings WHERE setting_key = 'shorts_api_settings'"
        );

        let data = {};
        if (settings && settings.setting_value) {
            try {
                data = JSON.parse(settings.setting_value);
            } catch (e) {
                data = {};
            }
        }

        // API ?�는 마스??처리
        const maskApiKey = (key) => {
            if (!key || key.length < 8) return key;
            return key.substring(0, 4) + '****' + key.substring(key.length - 4);
        };

        // ?�답?�서 API ??마스??(?�라?�언?�에?�는 ?�체 ?��? �????�음)
        const maskedData = JSON.parse(JSON.stringify(data));
        if (maskedData.image?.apiKey) maskedData.image.apiKey = maskApiKey(maskedData.image.apiKey);
        if (maskedData.voice?.apiKey) maskedData.voice.apiKey = maskApiKey(maskedData.voice.apiKey);
        if (maskedData.music?.apiKey) maskedData.music.apiKey = maskApiKey(maskedData.music.apiKey);
        if (maskedData.video?.apiKey) maskedData.video.apiKey = maskApiKey(maskedData.video.apiKey);

        res.json({
            success: true,
            data: maskedData
        });
    } catch (error) {
        next(error);
    }
};

/**
 * ?�츠 API ?�정 ?�??
 */
exports.updateShortsSettings = async (req, res, next) => {
    try {
        const settings = req.body;

        // 기존 ?�정 가?�오�?(??API ?��? 마스?�된 경우 기존 �??��?)
        const existingSettings = await queryOne(
            "SELECT setting_value FROM system_settings WHERE setting_key = 'shorts_api_settings'"
        );

        let existing = {};
        if (existingSettings && existingSettings.setting_value) {
            try {
                existing = JSON.parse(existingSettings.setting_value);
            } catch (e) {}
        }

        // 마스?�된 API ?�는 기존 �??��?
        const preserveApiKey = (newVal, existingVal, keyName) => {
            if (newVal && newVal.includes && newVal.includes('****') && existingVal) {
                return existingVal;
            }
            return newVal;
        };

        if (settings.image) {
            settings.image.apiKey = preserveApiKey(settings.image.apiKey, existing.image?.apiKey);
        }
        if (settings.voice) {
            settings.voice.apiKey = preserveApiKey(settings.voice.apiKey, existing.voice?.apiKey);
        }
        if (settings.music) {
            settings.music.apiKey = preserveApiKey(settings.music.apiKey, existing.music?.apiKey);
        }
        if (settings.video) {
            settings.video.apiKey = preserveApiKey(settings.video.apiKey, existing.video?.apiKey);
        }

        // SNS ?�정???�크릿도 ?�일?�게 처리
        if (settings.sns) {
            if (settings.sns.youtube) {
                settings.sns.youtube.clientSecret = preserveApiKey(
                    settings.sns.youtube.clientSecret,
                    existing.sns?.youtube?.clientSecret
                );
            }
            if (settings.sns.tiktok) {
                settings.sns.tiktok.clientSecret = preserveApiKey(
                    settings.sns.tiktok.clientSecret,
                    existing.sns?.tiktok?.clientSecret
                );
            }
            if (settings.sns.instagram) {
                settings.sns.instagram.appSecret = preserveApiKey(
                    settings.sns.instagram.appSecret,
                    existing.sns?.instagram?.appSecret
                );
            }
            if (settings.sns.facebook) {
                settings.sns.facebook.appSecret = preserveApiKey(
                    settings.sns.facebook.appSecret,
                    existing.sns?.facebook?.appSecret
                );
            }
        }

        const settingValue = JSON.stringify(settings);

        // UPSERT
        const existingRow = await queryOne(
            "SELECT id FROM system_settings WHERE setting_key = 'shorts_api_settings'"
        );

        if (existingRow) {
            await update('system_settings',
                { setting_value: settingValue, updated_at: new Date() },
                'setting_key = ?',
                ['shorts_api_settings']
            );
        } else {
            await insert('system_settings', {
                setting_key: 'shorts_api_settings',
                setting_value: settingValue,
                description: '?�츠 ?�작 �?배포???��? API ?�정'
            });
        }

        res.json({
            success: true,
            message: '?�츠 API ?�정???�?�되?�습?�다.'
        });
    } catch (error) {
        next(error);
    }
};

exports.getSettings = async (req, res, next) => {
    try {
        const settings = await query('SELECT setting_key, setting_value, description FROM system_settings');

        const settingsMap = {};
        settings.forEach(function(s) {
            try {
                settingsMap[s.setting_key] = {
                    value: JSON.parse(s.setting_value),
                    description: s.description
                };
            } catch (e) {
                settingsMap[s.setting_key] = {
                    value: s.setting_value,
                    description: s.description
                };
            }
        });

        res.json({
            success: true,
            data: settingsMap
        });
    } catch (error) {
        next(error);
    }
};

/**
 * ?�스???�정 변�?
 */
exports.updateSettings = async (req, res, next) => {
    try {
        const { settings } = req.body;

        for (const [key, value] of Object.entries(settings)) {
            const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value);

            const existing = await queryOne('SELECT id FROM system_settings WHERE setting_key = ?', [key]);

            if (existing) {
                await update('system_settings', { setting_value: stringValue }, 'setting_key = ?', [key]);
            } else {
                await insert('system_settings', {
                    setting_key: key,
                    setting_value: stringValue
                });
            }
        }

        res.json({
            success: true,
            message: '?�정???�?�되?�습?�다.'
        });
    } catch (error) {
        next(error);
    }
};

// ==========================================
// API ?�용??모니?�링
// ==========================================

/**
 * API ?�용???�계
 */
exports.getApiUsage = async (req, res, next) => {
    try {
        const { startDate, endDate, service } = req.query;

        let whereClause = '1=1';
        const params = [];

        if (startDate) {
            whereClause += ' AND DATE(created_at) >= ?';
            params.push(startDate);
        }

        if (endDate) {
            whereClause += ' AND DATE(created_at) <= ?';
            params.push(endDate);
        }

        if (service) {
            whereClause += ' AND service_name = ?';
            params.push(service);
        }

        const [usageByService, dailyUsage, totalTokens] = await Promise.all([
            query(`
                SELECT
                    service_name,
                    COUNT(*) as call_count,
                    SUM(tokens_used) as total_tokens,
                    AVG(response_time_ms) as avg_response_time
                FROM api_usage_logs
                WHERE ${whereClause}
                GROUP BY service_name
            `, params),
            query(`
                SELECT
                    DATE(created_at) as date,
                    COUNT(*) as call_count,
                    SUM(tokens_used) as total_tokens
                FROM api_usage_logs
                WHERE ${whereClause}
                GROUP BY DATE(created_at)
                ORDER BY date DESC
                LIMIT 30
            `, params),
            queryOne(`
                SELECT
                    SUM(tokens_used) as total,
                    SUM(CASE WHEN success = TRUE THEN tokens_used ELSE 0 END) as successful_tokens
                FROM api_usage_logs
                WHERE ${whereClause}
            `, params)
        ]);

        res.json({
            success: true,
            data: {
                byService: usageByService.map(function(u) {
                    return {
                        service: u.service_name,
                        callCount: u.call_count,
                        totalTokens: u.total_tokens || 0,
                        avgResponseTime: Math.round(u.avg_response_time || 0)
                    };
                }),
                daily: dailyUsage.map(function(d) {
                    return {
                        date: d.date,
                        callCount: d.call_count,
                        totalTokens: d.total_tokens || 0
                    };
                }),
                totals: {
                    totalTokens: totalTokens ? totalTokens.total || 0 : 0,
                    successfulTokens: totalTokens ? totalTokens.successful_tokens || 0 : 0
                }
            }
        });
    } catch (error) {
        next(error);
    }
};

// ==========================================
// ?�업 ??관�?
// ==========================================

/**
 * ?�업 ???�태 조회
 */
exports.getJobQueue = async (req, res, next) => {
    try {
        const { status, jobType, page = 1, limit = 20 } = req.query;

        let whereClause = '1=1';
        const params = [];

        if (status) {
            whereClause += ' AND status = ?';
            params.push(status);
        }

        if (jobType) {
            whereClause += ' AND job_type = ?';
            params.push(jobType);
        }

        const result = await paginate(`
            SELECT id, job_type, payload, status, priority,
                   attempts, max_attempts, error_message,
                   scheduled_at, started_at, completed_at, created_at
            FROM job_queue
            WHERE ${whereClause}
        `, params, {
            page: parseInt(page),
            limit: parseInt(limit),
            orderBy: 'priority DESC, created_at ASC'
        });

        // ???�계
        const stats = await queryOne(`
            SELECT
                SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
                SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
            FROM job_queue
        `);

        res.json({
            success: true,
            data: {
                jobs: result.items.map(function(j) {
                    return {
                        id: j.id,
                        type: j.job_type,
                        payload: j.payload ? JSON.parse(j.payload) : null,
                        status: j.status,
                        priority: j.priority,
                        attempts: j.attempts,
                        maxAttempts: j.max_attempts,
                        errorMessage: j.error_message,
                        scheduledAt: j.scheduled_at,
                        startedAt: j.started_at,
                        completedAt: j.completed_at,
                        createdAt: j.created_at
                    };
                }),
                stats: {
                    pending: stats.pending || 0,
                    processing: stats.processing || 0,
                    completed: stats.completed || 0,
                    failed: stats.failed || 0
                }
            },
            pagination: result.pagination
        });
    } catch (error) {
        next(error);
    }
};

/**
 * ?�패???�업 ?�시??
 */
exports.retryJob = async (req, res, next) => {
    try {
        const { id } = req.params;

        await update('job_queue', {
            status: 'pending',
            attempts: 0,
            error_message: null
        }, 'id = ?', [id]);

        res.json({
            success: true,
            message: '?�업???�시???�기열??추�??�었?�니??'
        });
    } catch (error) {
        next(error);
    }
};

/**
 * ?�업 취소
 */
exports.cancelJob = async (req, res, next) => {
    try {
        const { id } = req.params;

        await update('job_queue', { status: 'cancelled' }, 'id = ? AND status IN (?, ?)', [id, 'pending', 'processing']);

        res.json({
            success: true,
            message: '?�업??취소?�었?�니??'
        });
    } catch (error) {
        next(error);
    }
};

// ==========================================
// ?�문 ?�집 �?AI 처리
// ==========================================

/**
 * ?�문 ?�집 ?�작
 */
exports.startPaperCollect = async (req, res, next) => {
    try {
        const paperCollector = require('../jobs/paperCollector');

        // ?��?줄러?�서 ?�출??경우 로그
        if (req.isScheduler) {
            console.log('?�� Windows Task Scheduler?�서 ?�문 ?�집 ?�청');
            paperCollector.addLog('info', 'Windows Task Scheduler?�서 ?�동 ?�집 ?�작');
        }

        // ?��? ?�행 중인지 ?�인
        const status = paperCollector.getStatus();
        if (status.isRunning) {
            return res.status(HTTP_STATUS.CONFLICT).json({
                success: false,
                error: { code: ERROR_CODES.DUPLICATE_ENTRY, message: '?�문 ?�집???��? ?�행 중입?�다.' }
            });
        }

        // 비동기로 ?�집 ?�작 (?�답?� 먼�? 반환)
        paperCollector.run().catch(function(err) {
            console.error('?�문 ?�집 ?�류:', err);
        });

        res.json({
            success: true,
            message: '?�문 ?�집???�작?�었?�니??'
        });
    } catch (error) {
        next(error);
    }
};

/**
 * ?�문 ?�집 진행�?조회
 */
exports.getPaperCollectProgress = async (req, res, next) => {
    try {
        const paperCollector = require('../jobs/paperCollector');
        const status = paperCollector.getStatus();

        res.json({
            success: true,
            data: {
                isRunning: status.isRunning,
                lastRun: status.lastRun,
                stats: status.stats,
                progress: status.progress || {
                    currentCategory: '',
                    currentCategoryIndex: 0,
                    totalCategories: 0,
                    percentage: status.isRunning ? 0 : 100,
                    status: status.isRunning ? 'running' : 'idle',
                    message: status.isRunning ? '?�집 �?..' : ''
                }
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * AI 처리 ?�작
 */
exports.startAiProcess = async (req, res, next) => {
    try {
        const aiProcessor = require('../jobs/aiProcessor');

        // ?��? ?�행 중인지 ?�인
        const status = aiProcessor.getStatus();
        if (status.isRunning) {
            return res.status(HTTP_STATUS.CONFLICT).json({
                success: false,
                error: { code: ERROR_CODES.DUPLICATE_ENTRY, message: 'AI 처리가 ?��? ?�행 중입?�다.' }
            });
        }

        // 비동기로 처리 ?�작 (?�답?� 먼�? 반환)
        aiProcessor.run().catch(function(err) {
            console.error('AI 처리 ?�류:', err);
        });

        res.json({
            success: true,
            message: 'AI 처리가 ?�작?�었?�니??'
        });
    } catch (error) {
        next(error);
    }
};

// ==========================================
// ?��?�?관�?
// ==========================================

/**
 * ?�문 ?�집 ?��?�?조회
 */
exports.getPaperCollectSchedule = async (req, res, next) => {
    try {
        const paperCollector = require('../jobs/paperCollector');
        const schedule = paperCollector.getSchedule();
        const status = paperCollector.getStatus();

        // Windows Task Scheduler ?�태 조회
        let windowsTaskInfo = null;
        try {
            const { execSync } = require('child_process');
            const taskName = 'KoKive ?�문 ?�동 ?�집';
            const output = execSync(`schtasks /query /tn "${taskName}" /fo CSV /v`, { encoding: 'utf8' });

            // CSV ?�싱
            const lines = output.trim().split('\n');
            if (lines.length >= 2) {
                const headers = lines[0].split(',').map(h => h.replace(/"/g, ''));
                const values = lines[1].split(',').map(v => v.replace(/"/g, ''));

                const nextRunIdx = headers.findIndex(h => h.includes('?�음 ?�행 ?�간') || h.includes('Next Run Time'));
                const statusIdx = headers.findIndex(h => h.includes('?�태') || h.includes('Status'));
                const lastRunIdx = headers.findIndex(h => h.includes('마�?�??�행 ?�간') || h.includes('Last Run Time'));

                windowsTaskInfo = {
                    exists: true,
                    nextRun: nextRunIdx >= 0 ? values[nextRunIdx] : null,
                    status: statusIdx >= 0 ? values[statusIdx] : null,
                    lastRun: lastRunIdx >= 0 ? values[lastRunIdx] : null
                };
            }
        } catch (taskError) {
            // ?�업???�거??조회 ?�패
            windowsTaskInfo = { exists: false, error: taskError.message };
        }

        res.json({
            success: true,
            data: {
                schedule: schedule,
                isRunning: status.isRunning,
                lastRun: status.lastRun,
                windowsTask: windowsTaskInfo
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * ?�문 ?�집 ?��?�??�데?�트
 */
exports.updatePaperCollectSchedule = async (req, res, next) => {
    try {
        const { time, enabled } = req.body;

        // ?�간 ?�식 검�?(HH:MM)
        if (time && !/^([01]\d|2[0-3]):([0-5]\d)$/.test(time)) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json({
                success: false,
                error: { code: ERROR_CODES.VALIDATION_ERROR, message: '?�효?��? ?��? ?�간 ?�식?�니?? HH:MM ?�식???�용?�세??' }
            });
        }

        const paperCollector = require('../jobs/paperCollector');
        const finalTime = time || paperCollector.scheduledTime || '02:00';
        const finalEnabled = enabled !== undefined ? enabled : paperCollector.scheduleEnabled;

        const result = await paperCollector.updateSchedule(finalTime, finalEnabled);

        if (result.success) {
            // Windows Task Scheduler ?�데?�트 (schtasks 직접 ?�용)
            const { exec } = require('child_process');
            const taskName = 'KoKive ?�문 ?�동 ?�집';
            const scriptPath = 'C:\\inetpub\\wwwroot\\kokive\\scripts\\collect-papers.ps1';

            // 기존 ?�업 ??�� ???�로 ?�성
            const deleteCmd = `schtasks /delete /tn "${taskName}" /f`;

            exec(deleteCmd, (delError) => {
                // ??�� ?�패?�도 무시 (?�업???�을 ???�음)

                if (finalEnabled) {
                    const createCmd = `schtasks /create /tn "${taskName}" /tr "powershell.exe -ExecutionPolicy Bypass -File \\"${scriptPath}\\"" /sc daily /st ${finalTime} /ru SYSTEM /f`;

                    exec(createCmd, (createError, stdout, stderr) => {
                        if (createError) {
                            console.error('Windows Scheduler create failed:', createError.message);
                        } else {
                            console.log('Windows Scheduler task created for', finalTime);
                        }
                    });
                } else {
                    console.log('Windows Scheduler task disabled');
                }
            });

            res.json({
                success: true,
                message: '?��?줄이 ?�데?�트?�었?�니??' + (finalEnabled ? ` 매일 ${finalTime}???�동 ?�집?�니??` : ' ?�동 ?�집??비활?�화?�었?�니??'),
                data: paperCollector.getSchedule()
            });
        } else {
            res.status(HTTP_STATUS.INTERNAL_ERROR).json({
                success: false,
                error: { code: ERROR_CODES.DATABASE_ERROR, message: result.error }
            });
        }
    } catch (error) {
        next(error);
    }
};

// ==========================================
// ?�스?�터 관�?
// ==========================================

/**
 * ?�스?�터 ?�계 조회
 */
exports.getNewsletterStats = async (req, res, next) => {
    try {
        let totalSubscribers = 0;
        let byType = {};
        let monthSent = 0;
        let avgOpenRate = 0;
        let newSubscribers = 0;
        let unsubscribed = 0;
        let recentLogs = [];

        // �?쿼리�?개별 try-catch�?감싸???�나가 ?�패?�도 ?�른 것들?� ?�작?�도�?
        try {
            const result = await queryOne(
                'SELECT COUNT(*) as count FROM newsletter_subscriptions WHERE is_active = TRUE AND verified_at IS NOT NULL'
            );
            totalSubscribers = result?.count || 0;
        } catch (e) { console.error('Newsletter totalSubscribers error:', e.message); }

        try {
            const result = await query(
                `SELECT subscription_type, COUNT(*) as count
                FROM newsletter_subscriptions
                WHERE is_active = TRUE AND verified_at IS NOT NULL
                GROUP BY subscription_type`
            );
            byType = (result || []).reduce((acc, item) => {
                acc[item.subscription_type] = item.count;
                return acc;
            }, {});
        } catch (e) { console.error('Newsletter byType error:', e.message); }

        try {
            const result = await queryOne(
                `SELECT COUNT(*) as count FROM newsletter_logs
                WHERE sent_at >= DATE_FORMAT(NOW(), '%Y-%m-01')`
            );
            monthSent = result?.count || 0;
        } catch (e) { console.error('Newsletter monthSent error:', e.message); }

        try {
            const result = await query(
                `SELECT newsletter_type, subject, sent_count, open_count, click_count, sent_at
                FROM newsletter_logs
                ORDER BY sent_at DESC
                LIMIT 10`
            );
            recentLogs = (result || []).map(log => ({
                type: log.newsletter_type,
                subject: log.subject,
                sentCount: log.sent_count,
                openCount: log.open_count,
                clickCount: log.click_count,
                sentAt: log.sent_at
            }));
        } catch (e) { console.error('Newsletter recentLogs error:', e.message); }

        try {
            const result = await queryOne(
                `SELECT COUNT(*) as count FROM newsletter_subscriptions
                WHERE is_active = TRUE AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`
            );
            newSubscribers = result?.count || 0;
        } catch (e) { console.error('Newsletter newSubscribers error:', e.message); }

        try {
            const result = await queryOne(
                `SELECT COUNT(*) as count FROM newsletter_subscriptions
                WHERE is_active = FALSE AND unsubscribed_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`
            );
            unsubscribed = result?.count || 0;
        } catch (e) { console.error('Newsletter unsubscribed error:', e.message); }

        try {
            const result = await queryOne(
                `SELECT AVG(CASE WHEN sent_count > 0 THEN (open_count / sent_count * 100) ELSE 0 END) as avgOpenRate
                FROM newsletter_logs
                WHERE sent_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`
            );
            avgOpenRate = Math.round(result?.avgOpenRate || 0);
        } catch (e) { console.error('Newsletter avgOpenRate error:', e.message); }

        res.json({
            success: true,
            data: {
                totalSubscribers,
                byType,
                monthSent,
                avgOpenRate,
                newSubscribers,
                unsubscribed,
                recentLogs
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 뉴스레터 구독자 목록 조회
 * newsletter_subscriptions 테이블 + users 테이블에서 뉴스레터 구독자 조회
 */
exports.getNewsletterSubscribers = async (req, res, next) => {
    try {
        const { page = 1, limit = 20, email, status, type, source } = req.query;

        // source=users 파라미터가 있거나 테스트 발송용이면 users 테이블에서 뉴스레터 구독자 조회
        if (source === 'users') {
            let whereClause = '1=1';
            const params = [];

            if (email) {
                whereClause += ' AND u.email LIKE ?';
                params.push('%' + email + '%');
            }

            // users 테이블에서 뉴스레터 구독 중인 사용자 조회
            const result = await paginate(`
                SELECT u.id, u.email, u.nickname, ns.id as subscription_id
                FROM users u
                LEFT JOIN newsletter_subscriptions ns ON u.id = ns.user_id
                WHERE ${whereClause} AND ns.id IS NOT NULL
            `, params, {
                page: parseInt(page),
                limit: parseInt(limit),
                orderBy: 'u.created_at DESC'
            });

            const items = result.items || [];

            return res.json({
                success: true,
                data: items.map(user => ({
                    id: user.id,
                    email: user.email,
                    nickname: user.nickname,
                    subscriptionType: 'daily',
                    isActive: true
                })),
                pagination: result.pagination
            });
        }

        // 기본: newsletter_subscriptions 테이블 조회
        let whereClause = '1=1';
        const params = [];

        if (email) {
            whereClause += ' AND email LIKE ?';
            params.push('%' + email + '%');
        }

        if (status === 'active') {
            whereClause += ' AND is_active = TRUE AND verified_at IS NOT NULL';
        } else if (status === 'pending') {
            whereClause += ' AND is_active = TRUE AND verified_at IS NULL';
        } else if (status === 'inactive') {
            whereClause += ' AND is_active = FALSE';
        }

        if (type) {
            whereClause += ' AND subscription_type = ?';
            params.push(type);
        }

        const result = await paginate(`
            SELECT id, email, user_id, subscription_type, categories,
                   is_active, verified_at, created_at, unsubscribed_at
            FROM newsletter_subscriptions
            WHERE ${whereClause}
        `, params, {
            page: parseInt(page),
            limit: parseInt(limit),
            orderBy: 'created_at DESC'
        });

        // paginate 함수는 items를 반환함 (data가 아님)
        let items = result.items || [];

        // newsletter_subscriptions가 비어있으면 users 테이블에서 모든 사용자 조회 (테스트용)
        if (items.length === 0) {
            const usersResult = await paginate(`
                SELECT id, email, nickname, created_at
                FROM users
                WHERE 1=1 ${email ? ' AND email LIKE ?' : ''}
            `, email ? ['%' + email + '%'] : [], {
                page: parseInt(page),
                limit: parseInt(limit),
                orderBy: 'created_at DESC'
            });

            return res.json({
                success: true,
                data: (usersResult.items || []).map(user => ({
                    id: user.id,
                    email: user.email,
                    nickname: user.nickname,
                    subscriptionType: 'daily',
                    isActive: true,
                    createdAt: user.created_at
                })),
                pagination: usersResult.pagination,
                source: 'users'
            });
        }

        res.json({
            success: true,
            data: items.map(sub => ({
                id: sub.id,
                email: sub.email,
                userId: sub.user_id,
                subscriptionType: sub.subscription_type,
                categories: sub.categories ? (typeof sub.categories === 'string' ? JSON.parse(sub.categories) : sub.categories) : [],
                isActive: sub.is_active,
                verifiedAt: sub.verified_at,
                createdAt: sub.created_at,
                unsubscribedAt: sub.unsubscribed_at
            })),
            pagination: result.pagination
        });
    } catch (error) {
        console.error('Newsletter subscribers error:', error.message);
        // 테이블이 없는 경우 빈 배열 반환
        if (error.message && error.message.includes("doesn't exist")) {
            return res.json({
                success: true,
                data: [],
                pagination: { page: 1, limit: 20, total: 0, totalPages: 0, hasNext: false, hasPrev: false }
            });
        }
        next(error);
    }
};

/**
 * 뉴스레터 구독자 수정 (인증 상태 변경 포함)
 */
exports.updateNewsletterSubscriber = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { subscriptionType, isActive, forceVerify } = req.body;

        const updateData = {};
        if (subscriptionType) updateData.subscription_type = subscriptionType;
        if (typeof isActive === 'boolean') updateData.is_active = isActive;

        // 강제 인증 처리
        if (forceVerify === true) {
            updateData.verified_at = new Date();
            updateData.verification_token = null;
        }

        if (Object.keys(updateData).length === 0) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json({
                success: false,
                error: { message: '변경할 데이터가 없습니다.' }
            });
        }

        await update('newsletter_subscriptions', updateData, 'id = ?', [id]);

        res.json({
            success: true,
            message: '구독자 정보가 수정되었습니다.'
        });
    } catch (error) {
        next(error);
    }
};

/**
 * ?�스?�터 구독????��
 */
exports.deleteNewsletterSubscriber = async (req, res, next) => {
    try {
        const { id } = req.params;

        await remove('newsletter_subscriptions', 'id = ?', [id]);

        res.json({
            success: true,
            message: '구독?��? ??��?�었?�니??'
        });
    } catch (error) {
        next(error);
    }
};

/**
 * ?�스?�터 발송
 */
exports.sendNewsletter = async (req, res, next) => {
    try {
        const { subject, target, content, scheduledAt } = req.body;

        if (!subject || !content) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json({
                success: false,
                error: { code: ERROR_CODES.VALIDATION_ERROR, message: '?�목�??�용???�력?�주?�요.' }
            });
        }

        // ?�신 ?�??조회
        let whereClause = 'is_active = TRUE AND verified_at IS NOT NULL';
        if (target === 'daily') {
            whereClause += " AND subscription_type = 'daily'";
        } else if (target === 'weekly') {
            whereClause += " AND subscription_type = 'weekly'";
        }

        const subscribers = await query(
            `SELECT id, email FROM newsletter_subscriptions WHERE ${whereClause}`
        );

        if (!subscribers || subscribers.length === 0) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json({
                success: false,
                error: { code: ERROR_CODES.NOT_FOUND, message: '발송??구독?��? ?�습?�다.' }
            });
        }

        // TODO: ?�제 ?�메??발송 로직 구현 (?�약 발송 ?�함)
        // ?�재??로그�??�??

        await insert('newsletter_logs', {
            newsletter_type: target || 'all',
            subject: subject,
            content_html: content,
            sent_count: subscribers.length,
            open_count: 0,
            click_count: 0,
            sent_at: scheduledAt ? new Date(scheduledAt) : new Date()
        });

        res.json({
            success: true,
            message: `${subscribers.length}명에�??�스?�터가 발송?�었?�니??`
        });
    } catch (error) {
        next(error);
    }
};

// ==========================================
// 불완?�한 ?�문 검�?�??�처�?
// ==========================================

/**
 * 불완?�한 ?�문 ?�계 조회
 * (?�약, 번역, ?�운?�설 ?�이 ?�락???�문)
 */
exports.getIncompletePapersStats = async (req, res, next) => {
    try {
        let stats = {
            total: 0,
            missingSummary: 0,
            missingTranslation: 0,
            missingEasyExplanation: 0
        };

        try {
            const aiProcessor = require('../jobs/aiProcessor');
            stats = await aiProcessor.getIncompleteStats();
        } catch (e) {
            console.error('Incomplete papers stats error:', e.message);
        }

        res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 불완?�한 ?�문 목록 조회
 */
exports.getIncompletePapers = async (req, res, next) => {
    try {
        const { limit = 100 } = req.query;
        const aiProcessor = require('../jobs/aiProcessor');
        const papers = await aiProcessor.findIncompletePapers(parseInt(limit));

        res.json({
            success: true,
            data: {
                count: papers.length,
                papers: papers
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 불완?�한 ?�문 ?�괄 ?�처�?
 */
exports.reprocessIncompletePapers = async (req, res, next) => {
    try {
        const { limit = 10 } = req.body;
        const aiProcessor = require('../jobs/aiProcessor');

        // ?��? ?�행 중인지 ?�인
        const status = aiProcessor.getStatus();
        if (status.isRunning) {
            return res.status(HTTP_STATUS.CONFLICT).json({
                success: false,
                error: { code: ERROR_CODES.DUPLICATE_ENTRY, message: 'AI 처리가 ?��? ?�행 중입?�다.' }
            });
        }

        // 비동기로 ?�처�??�작 (?�답?� 먼�? 반환)
        aiProcessor.reprocessIncompletePapers(parseInt(limit)).catch(function(err) {
            console.error('불완?�한 ?�문 ?�처�??�류:', err);
        });

        res.json({
            success: true,
            message: `불완?�한 ?�문 ?�처리�? ?�작?�었?�니?? (최�? ${limit}�?`
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 최근 ?�집 ?�문 검�?�??�동 ?�처�?
 */
exports.validateAndReprocessRecent = async (req, res, next) => {
    try {
        const aiProcessor = require('../jobs/aiProcessor');

        // ?��? ?�행 중인지 ?�인
        const status = aiProcessor.getStatus();
        if (status.isRunning) {
            return res.status(HTTP_STATUS.CONFLICT).json({
                success: false,
                error: { code: ERROR_CODES.DUPLICATE_ENTRY, message: 'AI 처리가 ?��? ?�행 중입?�다.' }
            });
        }

        // 비동기로 검�?�??�처�??�작
        aiProcessor.validateAndReprocessAfterCollect().catch(function(err) {
            console.error('?�문 검�?�??�처�??�류:', err);
        });

        res.json({
            success: true,
            message: '최근 24?�간 ???�집???�문 검�?�??�처리�? ?�작?�었?�니??'
        });
    } catch (error) {
        next(error);
    }
};

/**
 * ?�일 ?�문 ?�처�?
 */
exports.reprocessSinglePaper = async (req, res, next) => {
    try {
        const { id } = req.params;
        const aiProcessor = require('../jobs/aiProcessor');

        // ?��? ?�행 중인지 ?�인
        const status = aiProcessor.getStatus();
        if (status.isRunning) {
            return res.status(HTTP_STATUS.CONFLICT).json({
                success: false,
                error: { code: ERROR_CODES.DUPLICATE_ENTRY, message: 'AI 처리가 ?��? ?�행 중입?�다.' }
            });
        }

        const result = await aiProcessor.reprocessPaperById(parseInt(id));

        if (result.success) {
            res.json({
                success: true,
                message: '?�문 ?�처리�? ?�료?�었?�니??',
                data: result
            });
        } else {
            res.status(HTTP_STATUS.INTERNAL_ERROR).json({
                success: false,
                error: { code: ERROR_CODES.PROCESSING_ERROR, message: result.error }
            });
        }
    } catch (error) {
        next(error);
    }
};

/**
 * ?�처�??�계 조회
 * (?�처�??�수, 비용, ?�패????모니?�링)
 */
exports.getReprocessStats = async (req, res, next) => {
    try {
        const aiProcessor = require('../jobs/aiProcessor');
        const stats = await aiProcessor.getReprocessStats();

        res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 종합 ?�문 모니?�링 API
 * 모든 ?�드 ?�태, 번역, ?�기 ?�수 ???�세 ?�보
 */
exports.getComprehensivePaperMonitoring = async (req, res, next) => {
    try {
        const {
            page = 1,
            limit = 20,
            status,
            category,
            search,
            incomplete,
            hasBasicTranslation,
            hasAdvancedTranslation,
            sortBy = 'created_at',
            sortOrder = 'DESC'
        } = req.query;

        let whereClause = '1=1';
        const params = [];

        if (status) {
            whereClause += ' AND p.processing_status = ?';
            params.push(status);
        }

        if (category) {
            whereClause += ' AND p.primary_category = ?';
            params.push(category);
        }

        if (search) {
            whereClause += ' AND (p.title_ko LIKE ? OR p.title_en LIKE ? OR p.arxiv_id LIKE ?)';
            const searchPattern = '%' + search + '%';
            params.push(searchPattern, searchPattern, searchPattern);
        }

        // 불완???�터
        if (incomplete === 'true') {
            whereClause += ` AND (
                p.title_ko IS NULL OR p.title_ko = '' OR
                p.abstract_ko IS NULL OR p.abstract_ko = '' OR
                ps.tldr IS NULL OR ps.tldr = '' OR
                ps.summary_detailed IS NULL OR ps.summary_detailed = ''
            )`;
        }

        // 번역 ?�터
        if (hasBasicTranslation === 'true') {
            whereClause += ` AND EXISTS (SELECT 1 FROM paper_translations pt WHERE pt.paper_id = p.id AND pt.translation_tier = 'haiku' AND pt.status = 'completed')`;
        } else if (hasBasicTranslation === 'false') {
            whereClause += ` AND NOT EXISTS (SELECT 1 FROM paper_translations pt WHERE pt.paper_id = p.id AND pt.translation_tier = 'haiku' AND pt.status = 'completed')`;
        }

        if (hasAdvancedTranslation === 'true') {
            whereClause += ` AND EXISTS (SELECT 1 FROM paper_translations pt WHERE pt.paper_id = p.id AND pt.translation_tier = 'sonnet' AND pt.status = 'completed')`;
        } else if (hasAdvancedTranslation === 'false') {
            whereClause += ` AND NOT EXISTS (SELECT 1 FROM paper_translations pt WHERE pt.paper_id = p.id AND pt.translation_tier = 'sonnet' AND pt.status = 'completed')`;
        }

        const allowedSortFields = ['created_at', 'published_at', 'title_ko', 'processing_status', 'basic_read_count', 'advanced_read_count'];
        const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'created_at';
        const order = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

        // 메인 쿼리 - 종합 ?�보
        const result = await paginate(`
            SELECT
                p.id, p.arxiv_id, p.title_ko, p.title_en,
                p.abstract_ko, p.abstract_en,
                p.primary_category, p.processing_status,
                p.published_at, p.created_at,
                p.pdf_url, p.pdf_stored_path,
                COALESCE(p.reprocess_count, 0) as reprocess_count,
                p.last_reprocessed_at,

                ps.tldr,
                ps.one_line_summary,
                ps.summary_3line,
                ps.summary_detailed,

                basic_trans.id as basic_translation_id,
                basic_trans.status as basic_translation_status,
                basic_trans.created_at as basic_translation_created,
                COALESCE(basic_reads.read_count, 0) as basic_read_count,

                advanced_trans.id as advanced_translation_id,
                advanced_trans.status as advanced_translation_status,
                advanced_trans.created_at as advanced_translation_created,
                COALESCE(advanced_reads.read_count, 0) as advanced_read_count,

                CASE WHEN p.title_ko IS NULL OR p.title_ko = '' THEN 1 ELSE 0 END as missing_title_ko,
                CASE WHEN p.abstract_ko IS NULL OR p.abstract_ko = '' THEN 1 ELSE 0 END as missing_abstract_ko,
                CASE WHEN ps.tldr IS NULL OR ps.tldr = '' THEN 1 ELSE 0 END as missing_tldr,
                CASE WHEN ps.one_line_summary IS NULL OR ps.one_line_summary = '' THEN 1 ELSE 0 END as missing_one_line,
                CASE WHEN ps.summary_detailed IS NULL OR ps.summary_detailed = '' THEN 1 ELSE 0 END as missing_summary_detailed

            FROM papers p
            LEFT JOIN paper_summaries ps ON p.id = ps.paper_id
            LEFT JOIN paper_translations basic_trans ON p.id = basic_trans.paper_id AND basic_trans.translation_tier = 'haiku' AND basic_trans.status = 'completed'
            LEFT JOIN paper_translations advanced_trans ON p.id = advanced_trans.paper_id AND advanced_trans.translation_tier = 'sonnet' AND advanced_trans.status = 'completed'
            LEFT JOIN (
                SELECT pt.paper_id, COUNT(*) as read_count
                FROM paper_reading_history prh
                JOIN paper_translations pt ON prh.translation_id = pt.id
                WHERE pt.translation_tier = 'haiku'
                GROUP BY pt.paper_id
            ) basic_reads ON p.id = basic_reads.paper_id
            LEFT JOIN (
                SELECT pt.paper_id, COUNT(*) as read_count
                FROM paper_reading_history prh
                JOIN paper_translations pt ON prh.translation_id = pt.id
                WHERE pt.translation_tier = 'sonnet'
                GROUP BY pt.paper_id
            ) advanced_reads ON p.id = advanced_reads.paper_id
            WHERE ${whereClause}
        `, params, {
            page: parseInt(page),
            limit: parseInt(limit),
            orderBy: sortField.includes('read_count') ? sortField + ' ' + order : 'p.' + sortField + ' ' + order
        });

        // ?�성???�수 계산 ?�수
        function calcScore(paper) {
            let score = 0;
            if (paper.title_ko && paper.title_ko.trim()) score += 1;
            if (paper.abstract_en && paper.abstract_en.trim()) score += 1;
            if (paper.abstract_ko && paper.abstract_ko.trim()) score += 1;
            if (paper.summary_detailed && paper.summary_detailed.trim()) score += 1;
            if (paper.tldr && paper.tldr.trim()) score += 1;
            if (paper.one_line_summary && paper.one_line_summary.trim()) score += 1;
            if (paper.summary_3line && paper.summary_3line.trim()) score += 1;
            if (paper.basic_translation_id) score += 1;
            if (paper.advanced_translation_id) score += 1;
            if (paper.pdf_stored_path) score += 1;
            return score;
        }

        res.json({
            success: true,
            data: result.items.map(p => ({
                id: p.id,
                arxivId: p.arxiv_id,
                category: p.primary_category,
                status: p.processing_status,
                publishedAt: p.published_at,
                createdAt: p.created_at,
                title: {
                    en: p.title_en,
                    ko: p.title_ko,
                    hasKo: !!(p.title_ko && p.title_ko.trim())
                },
                abstracts: {
                    en: !!p.abstract_en,
                    ko: !!p.abstract_ko,
                    easy: !!(p.summary_detailed && p.summary_detailed.trim())
                },
                summaries: {
                    tldr: !!(p.tldr && p.tldr.trim()),
                    oneLine: !!(p.one_line_summary && p.one_line_summary.trim()),
                    detailed: !!(p.summary_detailed && p.summary_detailed.trim())
                },
                files: {
                    pdfUrl: p.pdf_url,
                    pdfStored: !!p.pdf_stored_path
                },
                basicTranslation: {
                    exists: !!p.basic_translation_id,
                    status: p.basic_translation_status || null,
                    createdAt: p.basic_translation_created || null,
                    readCount: p.basic_read_count || 0
                },
                advancedTranslation: {
                    exists: !!p.advanced_translation_id,
                    status: p.advanced_translation_status || null,
                    createdAt: p.advanced_translation_created || null,
                    readCount: p.advanced_read_count || 0
                },
                reprocess: {
                    count: p.reprocess_count,
                    lastAt: p.last_reprocessed_at
                },
                completenessScore: calcScore(p)
            })),
            pagination: result.pagination
        });
    } catch (error) {
        next(error);
    }
};

/**
 * API ?�용???�세 조회 (비용 ?�함)
 */
exports.getApiUsageDetailed = async (req, res, next) => {
    try {
        const { startDate, endDate, service, operationType, page = 1, limit = 50 } = req.query;

        let whereClause = '1=1';
        const params = [];

        if (startDate) {
            whereClause += ' AND DATE(created_at) >= ?';
            params.push(startDate);
        }

        if (endDate) {
            whereClause += ' AND DATE(created_at) <= ?';
            params.push(endDate);
        }

        if (service) {
            whereClause += ' AND service_name LIKE ?';
            params.push('%' + service + '%');
        }

        if (operationType) {
            whereClause += ' AND operation_type = ?';
            params.push(operationType);
        }

        const [
            usageByService,
            usageByOperation,
            dailyCost,
            totalStats,
            recentLogs,
            translationCosts
        ] = await Promise.all([
            query(`
                SELECT
                    service_name,
                    COUNT(*) as call_count,
                    SUM(tokens_used) as total_tokens,
                    SUM(input_tokens) as total_input,
                    SUM(output_tokens) as total_output,
                    SUM(cost_usd) as total_cost,
                    AVG(response_time_ms) as avg_response_time,
                    SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as success_count
                FROM api_usage_logs
                WHERE ${whereClause}
                GROUP BY service_name
                ORDER BY total_cost DESC
            `, params),
            query(`
                SELECT
                    operation_type,
                    COUNT(*) as call_count,
                    SUM(tokens_used) as total_tokens,
                    SUM(cost_usd) as total_cost
                FROM api_usage_logs
                WHERE ${whereClause} AND operation_type IS NOT NULL
                GROUP BY operation_type
                ORDER BY total_cost DESC
            `, params),
            query(`
                SELECT
                    DATE(created_at) as date,
                    COUNT(*) as call_count,
                    SUM(tokens_used) as total_tokens,
                    SUM(cost_usd) as total_cost
                FROM api_usage_logs
                WHERE ${whereClause}
                GROUP BY DATE(created_at)
                ORDER BY date DESC
                LIMIT 30
            `, params),
            queryOne(`
                SELECT
                    COUNT(*) as total_calls,
                    SUM(tokens_used) as total_tokens,
                    SUM(input_tokens) as total_input_tokens,
                    SUM(output_tokens) as total_output_tokens,
                    SUM(cost_usd) as total_cost,
                    AVG(response_time_ms) as avg_response_time,
                    SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as success_count
                FROM api_usage_logs
                WHERE ${whereClause}
            `, params),
            paginate(`
                SELECT
                    id, service_name, paper_id, operation_type, model_used,
                    tokens_used, input_tokens, output_tokens, cost_usd,
                    response_time_ms, success, error_message, created_at
                FROM api_usage_logs
                WHERE ${whereClause}
            `, params, {
                page: parseInt(page),
                limit: parseInt(limit),
                orderBy: 'created_at DESC'
            }),
            // 번역 비용 (paper_translations ?�이�?
            query(`
                SELECT
                    CONCAT('translation_', translation_tier) as service_name,
                    COUNT(*) as call_count,
                    SUM(token_count) as total_tokens,
                    SUM(cost_usd) as total_cost
                FROM paper_translations
                WHERE status = 'completed'
                GROUP BY translation_tier
            `)
        ]);

        // 번역 비용???�비?�별 ?�계??추�?
        const translationServices = translationCosts.map(t => ({
            service: t.service_name,
            callCount: t.call_count,
            totalTokens: t.total_tokens || 0,
            totalInput: 0,
            totalOutput: 0,
            totalCostUsd: parseFloat(t.total_cost || 0).toFixed(4),
            avgResponseTimeMs: 0,
            successRate: '100.0'
        }));

        // 번역 비용 ?�계
        const translationTotalCost = translationCosts.reduce((sum, t) => sum + parseFloat(t.total_cost || 0), 0);

        // API ?�용???�비??목록 ?�성
        const apiServices = usageByService.map(s => ({
            service: s.service_name,
            callCount: s.call_count,
            totalTokens: s.total_tokens || 0,
            totalInput: s.total_input || 0,
            totalOutput: s.total_output || 0,
            totalCostUsd: parseFloat(s.total_cost || 0).toFixed(4),
            avgResponseTimeMs: Math.round(s.avg_response_time || 0),
            successRate: s.call_count > 0 ? ((s.success_count / s.call_count) * 100).toFixed(1) : 0
        }));

        // 모든 ?�비???�합 (API + 번역)
        const allServices = [...apiServices, ...translationServices];

        // �?비용 (API + 번역)
        const apiTotalCost = parseFloat(totalStats?.total_cost || 0);
        const combinedTotalCost = apiTotalCost + translationTotalCost;

        res.json({
            success: true,
            data: {
                summary: {
                    totalCalls: totalStats?.total_calls || 0,
                    totalTokens: totalStats?.total_tokens || 0,
                    totalInputTokens: totalStats?.total_input_tokens || 0,
                    totalOutputTokens: totalStats?.total_output_tokens || 0,
                    totalCostUsd: combinedTotalCost.toFixed(4),
                    translationCostUsd: translationTotalCost.toFixed(4),
                    apiCostUsd: apiTotalCost.toFixed(4),
                    avgResponseTimeMs: Math.round(totalStats?.avg_response_time || 0),
                    successRate: totalStats?.total_calls > 0
                        ? ((totalStats.success_count / totalStats.total_calls) * 100).toFixed(1)
                        : 0
                },
                byService: allServices,
                byOperation: usageByOperation.map(o => ({
                    operation: o.operation_type,
                    callCount: o.call_count,
                    totalTokens: o.total_tokens || 0,
                    totalCostUsd: parseFloat(o.total_cost || 0).toFixed(4)
                })),
                dailyCost: dailyCost.map(d => ({
                    date: d.date,
                    callCount: d.call_count,
                    totalTokens: d.total_tokens || 0,
                    totalCostUsd: parseFloat(d.total_cost || 0).toFixed(4)
                })),
                recentLogs: recentLogs.items.map(log => ({
                    id: log.id,
                    service: log.service_name,
                    paperId: log.paper_id,
                    operation: log.operation_type,
                    model: log.model_used,
                    tokens: log.tokens_used,
                    inputTokens: log.input_tokens,
                    outputTokens: log.output_tokens,
                    costUsd: parseFloat(log.cost_usd || 0).toFixed(6),
                    responseTimeMs: log.response_time_ms,
                    success: log.success,
                    error: log.error_message,
                    createdAt: log.created_at
                })),
                logsPagination: recentLogs.pagination
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * ?�문 목록 조회 (관리자) - 불완???�태 ?�함
 */
exports.getPapersWithIncompleteStatus = async (req, res, next) => {
    try {
        const {
            page = 1,
            limit = 20,
            status,
            category,
            search,
            incomplete,
            missingField,
            translationFilter,
            includeViews = 'true',
            sortBy = 'created_at',
            sortOrder = 'DESC'
        } = req.query;

        let whereClause = '1=1';
        const params = [];

        if (status) {
            whereClause += ' AND p.processing_status = ?';
            params.push(status);
        }

        if (category) {
            whereClause += ' AND p.primary_category = ?';
            params.push(category);
        }

        if (search) {
            whereClause += ' AND (p.title_ko LIKE ? OR p.title_en LIKE ? OR p.arxiv_id LIKE ?)';
            const searchPattern = '%' + search + '%';
            params.push(searchPattern, searchPattern, searchPattern);
        }

        // 번역 ?�터
        if (translationFilter === 'both') {
            // 기본(haiku) + 고급(sonnet) ?????�료???�문
            whereClause += ` AND EXISTS (
                SELECT 1 FROM paper_translations pt
                WHERE pt.paper_id = p.id AND pt.translation_tier = 'haiku' AND pt.status = 'completed'
            ) AND EXISTS (
                SELECT 1 FROM paper_translations pt
                WHERE pt.paper_id = p.id AND pt.translation_tier = 'sonnet' AND pt.status = 'completed'
            )`;
        } else if (translationFilter === 'basic') {
            // 기본(haiku)�??�고 고급(sonnet)?� ?�는 ?�문
            whereClause += ` AND EXISTS (
                SELECT 1 FROM paper_translations pt
                WHERE pt.paper_id = p.id AND pt.translation_tier = 'haiku' AND pt.status = 'completed'
            ) AND NOT EXISTS (
                SELECT 1 FROM paper_translations pt
                WHERE pt.paper_id = p.id AND pt.translation_tier = 'sonnet' AND pt.status = 'completed'
            )`;
        } else if (translationFilter === 'advanced') {
            // 고급(sonnet) 번역???�는 ?�문 (기본 ?�무 ?��??�이)
            whereClause += ` AND EXISTS (
                SELECT 1 FROM paper_translations pt
                WHERE pt.paper_id = p.id AND pt.translation_tier = 'sonnet' AND pt.status = 'completed'
            )`;
        } else if (translationFilter === 'none') {
            // 번역???��? ?�는 ?�문
            whereClause += ` AND NOT EXISTS (
                SELECT 1 FROM paper_translations pt
                WHERE pt.paper_id = p.id AND pt.status = 'completed'
            )`;
        }

        // ?�정 ?�드 ?�락 ?�터
        if (missingField) {
            const fieldFilters = {
                'titleKo': "(p.title_ko IS NULL OR p.title_ko = '')",
                'abstractKo': "(p.abstract_ko IS NULL OR p.abstract_ko = '')",
                'tldr': "(ps.tldr IS NULL OR ps.tldr = '')",
                'oneLine': "(ps.one_line_summary IS NULL OR ps.one_line_summary = '')",
                'summaryDetailed': "(ps.summary_detailed IS NULL OR ps.summary_detailed = '')"
            };
            if (fieldFilters[missingField]) {
                whereClause += ' AND ' + fieldFilters[missingField];
            }
        }
        // 불완???�터 - ?�수 ?�드가 ?�락???�문 (any)
        else if (incomplete === 'true') {
            whereClause += ` AND (
                p.title_ko IS NULL OR p.title_ko = '' OR
                p.abstract_ko IS NULL OR p.abstract_ko = '' OR
                ps.tldr IS NULL OR ps.tldr = '' OR
                ps.one_line_summary IS NULL OR ps.one_line_summary = '' OR
                ps.summary_detailed IS NULL OR ps.summary_detailed = ''
            )`;
        }

        const allowedSortFields = ['created_at', 'published_at', 'title_ko', 'processing_status', 'reprocess_count'];
        const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'created_at';
        const order = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

        const result = await paginate(`
            SELECT
                p.id, p.arxiv_id, p.title_ko, p.title_en,
                p.primary_category, p.processing_status,
                p.published_at, p.created_at,
                COALESCE(p.reprocess_count, 0) as reprocess_count,
                p.last_reprocessed_at,
                (SELECT COUNT(*) FROM paper_ratings WHERE paper_id = p.id) as rating_count,
                ps.id as summary_id,
                CASE WHEN p.title_ko IS NULL OR p.title_ko = '' THEN 1 ELSE 0 END as missing_title_ko,
                CASE WHEN p.abstract_ko IS NULL OR p.abstract_ko = '' THEN 1 ELSE 0 END as missing_abstract_ko,
                CASE WHEN ps.tldr IS NULL OR ps.tldr = '' THEN 1 ELSE 0 END as missing_tldr,
                CASE WHEN ps.one_line_summary IS NULL OR ps.one_line_summary = '' THEN 1 ELSE 0 END as missing_one_line,
                CASE WHEN ps.summary_3line IS NULL OR ps.summary_3line = '' THEN 1 ELSE 0 END as missing_summary_3line,
                CASE WHEN ps.summary_detailed IS NULL OR ps.summary_detailed = '' THEN 1 ELSE 0 END as missing_summary_detailed,
                (SELECT pt.id FROM paper_translations pt WHERE pt.paper_id = p.id AND pt.translation_tier = 'haiku' AND pt.status = 'completed' LIMIT 1) as basic_translation_id,
                (SELECT pt.id FROM paper_translations pt WHERE pt.paper_id = p.id AND pt.translation_tier = 'sonnet' AND pt.status = 'completed' LIMIT 1) as advanced_translation_id,
                (SELECT COUNT(*) FROM paper_reading_history prh JOIN paper_translations pt ON prh.translation_id = pt.id WHERE pt.paper_id = p.id) as view_count,
                (SELECT COUNT(*) FROM paper_reading_history prh JOIN paper_translations pt ON prh.translation_id = pt.id WHERE pt.paper_id = p.id AND pt.translation_tier = 'haiku') as basic_views,
                (SELECT COUNT(*) FROM paper_reading_history prh JOIN paper_translations pt ON prh.translation_id = pt.id WHERE pt.paper_id = p.id AND pt.translation_tier = 'sonnet') as advanced_views
            FROM papers p
            LEFT JOIN paper_summaries ps ON p.id = ps.paper_id
            WHERE ${whereClause}
        `, params, {
            page: parseInt(page),
            limit: parseInt(limit),
            orderBy: 'p.' + sortField + ' ' + order
        });

        res.json({
            success: true,
            data: result.items.map(p => ({
                id: p.id,
                arxivId: p.arxiv_id,
                titleKo: p.title_ko,
                titleEn: p.title_en,
                category: p.primary_category,
                status: p.processing_status,
                ratingCount: p.rating_count,
                publishedAt: p.published_at,
                createdAt: p.created_at,
                reprocessCount: p.reprocess_count,
                lastReprocessedAt: p.last_reprocessed_at,
                isIncomplete: (p.missing_title_ko + p.missing_abstract_ko + p.missing_tldr + p.missing_one_line + p.missing_summary_3line + p.missing_summary_detailed) > 0,
                missingFields: {
                    titleKo: !!p.missing_title_ko,
                    abstractKo: !!p.missing_abstract_ko,
                    tldr: !!p.missing_tldr,
                    oneLine: !!p.missing_one_line,
                    summary3line: !!p.missing_summary_3line,
                    summaryDetailed: !!p.missing_summary_detailed
                },
                hasBasicTranslation: !!p.basic_translation_id,
                hasAdvancedTranslation: !!p.advanced_translation_id,
                views: {
                    total: p.view_count || 0,
                    abstract: 0,
                    basicTranslation: p.basic_views || 0,
                    advancedTranslation: p.advanced_views || 0
                }
            })),
            pagination: result.pagination
        });
    } catch (error) {
        next(error);
    }
};

// ==========================================
// 최소 비용 ?�처�?(Minimum Cost Reprocessing)
// ==========================================

/**
 * ?�일 ?�문 최소 비용 ?�처�?
 * ?�락???�드�??�택?�으�??�처리하??API 비용 최소??
 * POST /api/admin/papers/:id/reprocess-minimal
 */
exports.reprocessMinimalCost = async (req, res, next) => {
    try {
        const paperId = parseInt(req.params.id);
        const aiProcessor = require('../jobs/aiProcessor');

        // ?�문 존재 ?�인
        const paper = await queryOne('SELECT id, arxiv_id, title_en FROM papers WHERE id = ?', [paperId]);
        if (!paper) {
            return res.status(HTTP_STATUS.NOT_FOUND).json({
                success: false,
                error: { code: ERROR_CODES.NOT_FOUND, message: '?�문??찾을 ???�습?�다.' }
            });
        }

        // 최소 비용 ?�처�??�행
        const result = await aiProcessor.reprocessMissingFieldsOnly(paperId);

        res.json({
            success: true,
            data: {
                paperId: paperId,
                arxivId: paper.arxiv_id,
                skipped: result.skipped || false,
                missingFields: result.missingFields || {},
                fieldsProcessed: result.fieldsProcessed || 0,
                estimatedCost: result.estimatedCost || 0,
                actualCost: result.actualCost || 0,
                savedCost: result.savedCost || 0,
                message: result.skipped
                    ? '모든 ?�드가 ?��? 존재?�니?? ?�처리�? ?�요?��? ?�습?�다.'
                    : `${result.fieldsProcessed}�??�드가 ?�처리되?�습?�다.`
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * ?�중 ?�문 최소 비용 ?�괄 ?�처�?
 * POST /api/admin/papers/reprocess-minimal-batch
 */
exports.reprocessMinimalCostBatch = async (req, res, next) => {
    try {
        const { limit = 10, dryRun = false } = req.body;
        const aiProcessor = require('../jobs/aiProcessor');

        if (dryRun) {
            // ?�라?�런: ?�제 처리 ?�이 ?�상 비용�?계산
            const papers = await aiProcessor.findIncompletePapers(parseInt(limit));

            let totalEstimatedCost = 0;
            const paperEstimates = [];

            for (const paper of papers) {
                const missingFields = {
                    titleKo: !paper.title_ko || paper.title_ko.trim() === '',
                    abstractKo: !paper.abstract_ko || paper.abstract_ko.trim() === '',
                    tldr: !paper.tldr || paper.tldr.trim() === '',
                    oneLine: !paper.one_line_summary || paper.one_line_summary.trim() === '',
                    summary3line: !paper.summary_3line || paper.summary_3line.trim() === '',
                    summaryDetailed: !paper.summary_detailed || paper.summary_detailed.trim() === ''
                };

                const missingCount = Object.values(missingFields).filter(v => v).length;
                // ?�?�적??비용 추정: ?�드????$0.002 (Haiku 기�?)
                const estimatedCost = missingCount * 0.002;
                totalEstimatedCost += estimatedCost;

                paperEstimates.push({
                    paperId: paper.id,
                    arxivId: paper.arxiv_id,
                    missingFields,
                    missingCount,
                    estimatedCost: estimatedCost.toFixed(6)
                });
            }

            return res.json({
                success: true,
                dryRun: true,
                data: {
                    papersToProcess: papers.length,
                    totalEstimatedCost: totalEstimatedCost.toFixed(4),
                    papers: paperEstimates
                }
            });
        }

        // ?�제 ?�괄 ?�처�??�행
        const result = await aiProcessor.reprocessMinimalCost(parseInt(limit));

        res.json({
            success: true,
            data: {
                processedCount: result.processed || 0,
                skippedCount: result.skipped || 0,
                failedCount: result.failed || 0,
                totalCost: (result.totalCost || 0).toFixed(4),
                savedCost: (result.savedCost || 0).toFixed(4),
                results: result.results || []
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * ?�처�?비용 추정
 * GET /api/admin/papers/reprocess-estimate
 */
exports.getReprocessEstimate = async (req, res, next) => {
    try {
        const { limit = 50 } = req.query;
        const aiProcessor = require('../jobs/aiProcessor');

        // 불완???�문 조회
        const papers = await aiProcessor.findIncompletePapers(parseInt(limit));

        let totalMissingFields = 0;
        let totalEstimatedCost = 0;
        let totalFullReprocessCost = 0;
        const fieldStats = {
            titleKo: 0,
            abstractKo: 0,
            tldr: 0,
            oneLine: 0,
            summary3line: 0,
            summaryDetailed: 0
        };

        for (const paper of papers) {
            const missingFields = {
                titleKo: !paper.title_ko || paper.title_ko.trim() === '',
                abstractKo: !paper.abstract_ko || paper.abstract_ko.trim() === '',
                tldr: !paper.tldr || paper.tldr.trim() === '',
                oneLine: !paper.one_line_summary || paper.one_line_summary.trim() === '',
                summary3line: !paper.summary_3line || paper.summary_3line.trim() === '',
                summaryDetailed: !paper.summary_detailed || paper.summary_detailed.trim() === ''
            };

            let missingCount = 0;
            for (const [field, isMissing] of Object.entries(missingFields)) {
                if (isMissing) {
                    missingCount++;
                    fieldStats[field]++;
                }
            }

            totalMissingFields += missingCount;
            // ?�드????$0.002 (Haiku 기�?)
            totalEstimatedCost += missingCount * 0.002;
            // ?�체 ?�처리시 ??$0.012 per paper (모든 ?�드)
            totalFullReprocessCost += 0.012;
        }

        res.json({
            success: true,
            data: {
                incompletePapers: papers.length,
                totalMissingFields,
                minimalCost: {
                    estimatedUsd: totalEstimatedCost.toFixed(4),
                    description: '누락된 필드만 선택적 재처리'
                },
                fullReprocessCost: {
                    estimatedUsd: totalFullReprocessCost.toFixed(4),
                    description: '모든 필드 전체 재처리'
                },
                costSavings: {
                    savedUsd: (totalFullReprocessCost - totalEstimatedCost).toFixed(4),
                    savingsPercent: totalFullReprocessCost > 0
                        ? (((totalFullReprocessCost - totalEstimatedCost) / totalFullReprocessCost) * 100).toFixed(1)
                        : 0
                },
                fieldBreakdown: fieldStats
            }
        });
    } catch (error) {
        next(error);
    }
};

// ==========================================
// ?�문 ?�계 ?�약 API (papers.html??
// ==========================================

/**
 * ?�문 ?�계 ?�약
 * GET /api/admin/papers/stats-summary
 */
exports.getPaperStatsSummary = async (req, res, next) => {
    try {
        let totalPapers = 0;
        let basicTranslations = 0;
        let advancedTranslations = 0;
        let totalViews = 0;
        let totalFavorites = 0;

        // �?쿼리�?개별 try-catch�?감싸???�나가 ?�패?�도 ?�른 것들?� ?�작?�도�?
        try {
            const result = await queryOne('SELECT COUNT(*) as count FROM papers');
            totalPapers = result?.count || 0;
        } catch (e) { console.error('Paper count error:', e.message); }

        try {
            const result = await queryOne(`
                SELECT COUNT(DISTINCT paper_id) as count
                FROM paper_translations
                WHERE translation_tier = 'haiku' AND status = 'completed'
            `);
            basicTranslations = result?.count || 0;
        } catch (e) { console.error('Basic translations error:', e.message); }

        try {
            const result = await queryOne(`
                SELECT COUNT(DISTINCT paper_id) as count
                FROM paper_translations
                WHERE translation_tier = 'sonnet' AND status = 'completed'
            `);
            advancedTranslations = result?.count || 0;
        } catch (e) { console.error('Advanced translations error:', e.message); }

        try {
            const result = await queryOne('SELECT COUNT(*) as count FROM paper_reading_history');
            totalViews = result?.count || 0;
        } catch (e) { console.error('Reading history error:', e.message); }

        try {
            const result = await queryOne('SELECT COUNT(*) as count FROM paper_favorites');
            totalFavorites = result?.count || 0;
        } catch (e) { console.error('Favorites error:', e.message); }

        res.json({
            success: true,
            data: {
                totalPapers,
                basicTranslations,
                advancedTranslations,
                totalViews,
                totalFavorites
            }
        });
    } catch (error) {
        next(error);
    }
};

// ==========================================
// TTS ?�스??API
// ==========================================

/**
 * TTS ?�스??- Google Cloud TTS
 */
exports.testTTS = async (req, res, next) => {
    try {
        const { text, engine, voice, rate, pitch } = req.body;

        if (!text) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json({
                success: false,
                error: { code: ERROR_CODES.VALIDATION_ERROR, message: '?�스?��? ?�력?�주?�요.' }
            });
        }

        // ?�정?�서 API ??조회
        const settingsRow = await queryOne(
            "SELECT setting_value FROM system_settings WHERE setting_key = 'shorts_api_settings'"
        );

        const settings = settingsRow?.setting_value ? JSON.parse(settingsRow.setting_value) : {};

        let audioContent = null;

        if (engine === 'google') {
            // Google Cloud TTS
            const apiKey = settings.tts?.googleApiKey;
            if (!apiKey) {
                return res.status(HTTP_STATUS.BAD_REQUEST).json({
                    success: false,
                    error: { code: ERROR_CODES.VALIDATION_ERROR, message: 'Google Cloud API ?��? ?�정?��? ?�았?�니??' }
                });
            }

            const response = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    input: { text: text.substring(0, 500) }, // ?�스?�는 500?�로 ?�한
                    voice: {
                        languageCode: 'ko-KR',
                        name: voice || 'ko-KR-Wavenet-A'
                    },
                    audioConfig: {
                        audioEncoding: 'MP3',
                        speakingRate: rate || 1.0,
                        pitch: pitch || 0
                    }
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error?.message || 'Google TTS API ?�류');
            }

            const data = await response.json();
            audioContent = data.audioContent;

        } else if (engine === 'azure') {
            // Azure Speech (TODO: 구현)
            return res.status(HTTP_STATUS.BAD_REQUEST).json({
                success: false,
                error: { code: ERROR_CODES.VALIDATION_ERROR, message: 'Azure TTS??준�?중입?�다.' }
            });

        } else if (engine === 'elevenlabs') {
            // ElevenLabs (TODO: 구현)
            return res.status(HTTP_STATUS.BAD_REQUEST).json({
                success: false,
                error: { code: ERROR_CODES.VALIDATION_ERROR, message: 'ElevenLabs TTS??준�?중입?�다.' }
            });

        } else {
            return res.status(HTTP_STATUS.BAD_REQUEST).json({
                success: false,
                error: { code: ERROR_CODES.VALIDATION_ERROR, message: '지?�하지 ?�는 TTS ?�진?�니??' }
            });
        }

        res.json({
            success: true,
            data: {
                audioContent: audioContent, // Base64 encoded audio
                format: 'mp3',
                engine: engine
            }
        });
    } catch (error) {
        next(error);
    }
};

// ===========================================
// ?�랫???�정 관�?(범용)
// ===========================================

/**
 * ?�랫???�정 조회 (범용)
 * URL 경로?�서 ?�랫???�??추출
 */
exports.getPlatformSettings = async (req, res, next) => {
    try {
        // URL?�서 ?�정 ?�??추출 (?? /shorts/youtube-settings -> youtube)
        const pathMatch = req.path.match(/\/shorts\/([a-z]+)-settings/);
        const settingType = pathMatch ? pathMatch[1] : 'unknown';

        const settings = await queryOne(
            'SELECT * FROM system_settings WHERE setting_key = ?',
            [`shorts_${settingType}_settings`]
        );

        if (settings && settings.setting_value) {
            res.json({
                success: true,
                data: JSON.parse(settings.setting_value)
            });
        } else {
            // 기본�?반환
            res.json({
                success: true,
                data: getDefaultPlatformSettings(settingType)
            });
        }
    } catch (error) {
        next(error);
    }
};

/**
 * ?�랫???�정 ?�??(범용)
 */
exports.updatePlatformSettings = async (req, res, next) => {
    try {
        const pathMatch = req.path.match(/\/shorts\/([a-z]+)-settings/);
        const settingType = pathMatch ? pathMatch[1] : 'unknown';
        const settingKey = `shorts_${settingType}_settings`;

        const existing = await queryOne(
            'SELECT id FROM system_settings WHERE setting_key = ?',
            [settingKey]
        );

        const settingValue = JSON.stringify(req.body);

        if (existing) {
            await query(
                'UPDATE system_settings SET setting_value = ?, updated_at = NOW() WHERE setting_key = ?',
                [settingValue, settingKey]
            );
        } else {
            await query(
                'INSERT INTO system_settings (setting_key, setting_value, created_at, updated_at) VALUES (?, ?, NOW(), NOW())',
                [settingKey, settingValue]
            );
        }

        res.json({
            success: true,
            message: '?�정???�?�되?�습?�다.'
        });
    } catch (error) {
        next(error);
    }
};

/**
 * ?�랫?�별 기본 ?�정�?
 */
function getDefaultPlatformSettings(platform) {
    const defaults = {
        youtube: {
            apiKey: '',
            channelId: '',
            autoUpload: false,
            defaultPrivacy: 'private',
            defaultCategory: '28', // Science & Technology
            tags: ['AI', '인공지능', '논문']
        },
        tiktok: {
            accessToken: '',
            autoUpload: false,
            defaultPrivacy: 'private'
        },
        instagram: {
            accessToken: '',
            businessAccountId: '',
            autoUpload: false
        },
        facebook: {
            pageId: '',
            accessToken: '',
            autoUpload: false
        },
        engine: {
            ttsProvider: 'melotts',
            ttsVoice: 'KR',
            ttsSpeed: 1.0,
            aiModel: 'claude-3-5-sonnet',
            autoGenerate: false
        },
        deploy: {
            autoPublish: false,
            platforms: ['youtube'],
            scheduleTime: '09:00',
            timezone: 'Asia/Seoul'
        }
    };

    return defaults[platform] || {};
}

// ===========================================
// 배치 ?�이?�라??관�?
// ===========================================

/**
 * ?�이?�라???�태 조회
 * GET /api/admin/pipeline/status
 */
exports.getPipelineStatus = async (req, res, next) => {
    try {
        const { pipelineTriggers } = require('../jobs');
        const status = pipelineTriggers.getPipelineStatus();

        res.json({
            success: true,
            data: status
        });
    } catch (error) {
        next(error);
    }
};

/**
 * ?�이?�라???�정 조회
 * GET /api/admin/pipeline/config
 */
exports.getPipelineConfig = async (req, res, next) => {
    try {
        const { pipelineTriggers } = require('../jobs');
        const config = pipelineTriggers.getPipelineConfig();

        res.json({
            success: true,
            data: config
        });
    } catch (error) {
        next(error);
    }
};

/**
 * ?�이?�라???�정 ?�??
 * PUT /api/admin/pipeline/config
 */
exports.updatePipelineConfig = async (req, res, next) => {
    try {
        const { pipelineTriggers } = require('../jobs');
        const result = await pipelineTriggers.updatePipelineConfig(req.body);

        if (result.success) {
            res.json({
                success: true,
                message: '?�이?�라???�정???�?�되?�습?�다.'
            });
        } else {
            res.status(HTTP_STATUS.INTERNAL_ERROR).json({
                success: false,
                error: { code: ERROR_CODES.INTERNAL_ERROR, message: result.error || '?�정 ?�???�패' }
            });
        }
    } catch (error) {
        next(error);
    }
};

/**
 * ?�이?�라???�정 ?�계 ?�동 ?�행
 * POST /api/admin/pipeline/run/:stage
 */
exports.runPipelineStage = async (req, res, next) => {
    try {
        const { stage } = req.params;
        const { pipelineTriggers } = require('../jobs');

        const allowedStages = ['validation', 'shortsGen', 'shortsDeploy', 'newsletter'];
        if (!allowedStages.includes(stage)) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json({
                success: false,
                error: { code: ERROR_CODES.VALIDATION_ERROR, message: '?�효?��? ?��? ?�계?�니?? ' + stage }
            });
        }

        // 비동기로 ?�행 (?�답?� 먼�? 반환)
        pipelineTriggers.runPipelineStage(stage).catch(function(err) {
            console.error('?�이?�라???�계 ?�행 ?�류:', err);
        });

        res.json({
            success: true,
            message: '?�이?�라???�계가 ?�작?�었?�니?? ' + stage
        });
    } catch (error) {
        next(error);
    }
};

/**
 * ?�이?�라???�태 리셋
 * POST /api/admin/pipeline/reset
 */
exports.resetPipeline = async (req, res, next) => {
    try {
        const { pipelineTriggers } = require('../jobs');
        await pipelineTriggers.resetPipeline();

        res.json({
            success: true,
            message: '?�이?�라???�태가 리셋?�었?�니??'
        });
    } catch (error) {
        next(error);
    }
};

/**
 * ?�이?�라??로그 조회 - DB?�서 ?�제 ?�업 기록 ?�합
 * GET /api/admin/pipeline/logs
 */
exports.getPipelineLogs = async (req, res, next) => {
    try {
        const { limit = 100, filter } = req.query;
        const limitNum = Math.min(parseInt(limit) || 100, 500);

        // 1. job_queue?�서 ?�업 기록 (?�문?�집, AI처리 ??
        const jobLogs = await query(`
            SELECT
                id,
                job_type,
                status,
                error_message,
                COALESCE(completed_at, started_at, created_at) as event_time,
                created_at,
                started_at,
                completed_at
            FROM job_queue
            WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
            ORDER BY COALESCE(completed_at, started_at, created_at) DESC
            LIMIT ?
        `, [limitNum]);

        // 2. shorts?�서 ?�츠 ?�성/배포 기록
        const shortsLogs = await query(`
            SELECT
                id,
                title,
                status,
                audio_url,
                video_url,
                created_at,
                updated_at
            FROM shorts
            WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
            ORDER BY updated_at DESC
            LIMIT ?
        `, [limitNum]);

        // 3. papers?�서 최근 ?�집/처리???�문
        const paperLogs = await query(`
            SELECT
                id,
                title_ko,
                title_en,
                processing_status,
                created_at,
                updated_at
            FROM papers
            WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
            ORDER BY updated_at DESC
            LIMIT ?
        `, [limitNum]);

        // 4. paper_reprocess_logs?�서 ?�처�?기록 (?�는 경우)
        let reprocessLogs = [];
        try {
            reprocessLogs = await query(`
                SELECT
                    id,
                    paper_id,
                    reprocess_type,
                    status,
                    error_message,
                    created_at
                FROM paper_reprocess_logs
                WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
                ORDER BY created_at DESC
                LIMIT ?
            `, [limitNum]);
        } catch (e) {
            // 테이블이 없으면 무시
        }

        // 통합 로그 생성
        const unifiedLogs = [];

        // job_queue 로그 변환
        for (const job of jobLogs) {
            let stage = '작업';
            let message = '';
            let execType = 'auto';

            switch (job.job_type) {
                case 'paper_collect':
                    stage = '논문수집';
                    message = job.status === 'completed' ? '논문 수집 완료' :
                              job.status === 'failed' ? `논문 수집 실패: ${job.error_message || '알 수 없는 오류'}` :
                              job.status === 'processing' ? '논문 수집 중...' : '논문 수집 대기';
                    break;
                case 'ai_process':
                    stage = '검토';
                    message = job.status === 'completed' ? 'AI 처리 완료' :
                              job.status === 'failed' ? `AI 처리 실패: ${job.error_message || '알 수 없는 오류'}` :
                              job.status === 'processing' ? 'AI 처리 중...' : 'AI 처리 대기';
                    break;
                case 'embedding':
                    stage = '검토';
                    message = job.status === 'completed' ? '임베딩 생성 완료' :
                              job.status === 'failed' ? `임베딩 실패: ${job.error_message || ''}` : '임베딩 처리 중';
                    break;
                default:
                    stage = '작업';
                    message = `${job.job_type} - ${job.status}`;
            }

            unifiedLogs.push({
                time: job.event_time,
                stage: stage,
                message: message,
                type: job.status === 'completed' ? 'success' : job.status === 'failed' ? 'error' : 'info',
                executionType: execType,
                source: 'job_queue',
                sourceId: job.id
            });
        }

        // shorts 로그 변환
        for (const shorts of shortsLogs) {
            // 쇼츠 생성 기록
            if (shorts.audio_url) {
                unifiedLogs.push({
                    time: shorts.updated_at,
                    stage: '쇼츠생성',
                    message: `쇼츠 생성 완료: ${shorts.title?.substring(0, 30)}...`,
                    type: 'success',
                    executionType: 'manual',
                    source: 'shorts',
                    sourceId: shorts.id
                });
            }

            // 쇼츠 배포 기록
            if (shorts.status === 'published') {
                unifiedLogs.push({
                    time: shorts.updated_at,
                    stage: '쇼츠배포',
                    message: `쇼츠 배포 완료: ${shorts.title?.substring(0, 30)}...`,
                    type: 'success',
                    executionType: 'auto',
                    source: 'shorts',
                    sourceId: shorts.id
                });
            }
        }

        // 재처리 로그 변환
        for (const log of reprocessLogs) {
            unifiedLogs.push({
                time: log.created_at,
                stage: '검토',
                message: log.status === 'completed' ? `논문 ${log.paper_id} 재처리 완료 (${log.reprocess_type})` :
                         log.status === 'failed' ? `논문 ${log.paper_id} 재처리 실패: ${log.error_message || ''}` :
                         `논문 ${log.paper_id} 재처리 중`,
                type: log.status === 'completed' ? 'success' : log.status === 'failed' ? 'error' : 'info',
                executionType: 'manual',
                source: 'reprocess',
                sourceId: log.id
            });
        }

        // 시간순 정렬 (최신순)
        unifiedLogs.sort((a, b) => new Date(b.time) - new Date(a.time));

        // 필터 적용
        let filteredLogs = unifiedLogs;
        if (filter) {
            if (filter === 'auto') {
                filteredLogs = unifiedLogs.filter(l => l.executionType === 'auto');
            } else if (filter === 'manual') {
                filteredLogs = unifiedLogs.filter(l => l.executionType === 'manual');
            } else if (filter.startsWith('stage')) {
                const stageMap = {
                    'stage1': ['논문수집'],
                    'stage2': ['검토'],
                    'stage3': ['쇼츠생성'],
                    'stage4': ['쇼츠배포']
                };
                const stages = stageMap[filter] || [];
                filteredLogs = unifiedLogs.filter(l => stages.includes(l.stage));
            }
        }

        // 메모리 로그와 병합 (최근 실행 상태)
        try {
            const { pipelineTriggers } = require('../jobs');
            const memoryLogs = pipelineTriggers.getPipelineLogs(20);
            if (memoryLogs && memoryLogs.length > 0) {
                // 메모리 로그 병합
                filteredLogs = [...memoryLogs.map(l => ({
                    ...l,
                    executionType: l.executionType || 'auto',
                    source: 'memory'
                })), ...filteredLogs];

                // 병합 후 다시 최신순 정렬
                filteredLogs.sort((a, b) => new Date(b.time) - new Date(a.time));
            }
        } catch (e) {
            // 메모리 로그 없으면 무시
        }

        // 중복 제거 및 limit 적용
        const uniqueLogs = filteredLogs.slice(0, limitNum);

        res.json({
            success: true,
            data: uniqueLogs
        });
    } catch (error) {
        console.error('getPipelineLogs error:', error);
        next(error);
    }
};



/**
 * 뉴스레터 테스트 발송
 */
exports.testSendNewsletter = async (req, res, next) => {
    try {
        const { email, paperIds, subject, useAutoPapers } = req.body;

        if (!email) {
            return res.status(400).json({
                success: false,
                error: { message: '받는 사람 이메일을 입력해주세요.' }
            });
        }

        const emailService = require('../services/emailService');
        const crypto = require('crypto');

        let papers = [];

        if (useAutoPapers || !paperIds || paperIds.length === 0) {
            // 최근 24시간 내 논문 자동 선택
            const recentPapers = await query(`
                SELECT
                    p.id,
                    p.arxiv_id,
                    p.title_ko,
                    p.title_en,
                    p.primary_category as category,
                    p.authors,
                    p.created_at,
                    ps.tldr as summary_ko
                FROM papers p
                LEFT JOIN paper_summaries ps ON p.id = ps.paper_id
                WHERE p.created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
                  AND p.processing_status = 'completed'
                ORDER BY p.created_at DESC
                LIMIT 10
            `);
            papers = recentPapers;
        } else {
            // 선택된 논문 조회
            const paperIdList = paperIds.map(id => parseInt(id)).filter(id => !isNaN(id));
            if (paperIdList.length > 0) {
                const placeholders = paperIdList.map(() => '?').join(',');
                const selectedPapers = await query(`
                    SELECT
                        p.id,
                        p.arxiv_id,
                        p.title_ko,
                        p.title_en,
                        p.primary_category as category,
                        p.authors,
                        p.created_at,
                        ps.tldr as summary_ko
                    FROM papers p
                    LEFT JOIN paper_summaries ps ON p.id = ps.paper_id
                    WHERE p.id IN (${placeholders})
                `, paperIdList);
                papers = selectedPapers;
            }
        }

        if (papers.length === 0) {
            return res.status(400).json({
                success: false,
                error: { message: '발송할 논문이 없습니다. 최근 24시간 내 수집된 논문이 없거나 선택한 논문이 없습니다.' }
            });
        }

        // 구독 해지 토큰 생성 (테스트용)
        const unsubscribeToken = crypto.randomBytes(32).toString('hex');

        // 제목 생성
        const emailSubject = subject || `[KoKive] 관심 분야의 새 논문 ${papers.length}편이 등록되었습니다`;

        // 뉴스레터 발송
        await emailService.sendNewsletterEmail(
            email,
            emailSubject,
            papers,
            unsubscribeToken
        );

        console.log('Test newsletter sent to:', email, 'papers:', papers.length);

        res.json({
            success: true,
            data: {
                email: email,
                paperCount: papers.length,
                subject: emailSubject
            }
        });
    } catch (error) {
        console.error('Test newsletter send error:', error);
        res.status(500).json({
            success: false,
            error: { message: error.message || '뉴스레터 발송에 실패했습니다.' }
        });
    }
};

/**
 * 뉴스레터 미리보기
 */
exports.previewNewsletter = async (req, res, next) => {
    try {
        const { email, paperIds, subject } = req.query;

        let papers = [];

        if (!paperIds || paperIds === '') {
            // 최근 24시간 내 논문 자동 선택
            const recentPapers = await query(`
                SELECT
                    p.id,
                    p.arxiv_id,
                    p.title_ko,
                    p.title_en,
                    p.primary_category as category,
                    p.authors,
                    p.created_at,
                    ps.tldr as summary_ko
                FROM papers p
                LEFT JOIN paper_summaries ps ON p.id = ps.paper_id
                WHERE p.created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
                  AND p.processing_status = 'completed'
                ORDER BY p.created_at DESC
                LIMIT 10
            `);
            papers = recentPapers;
        } else {
            // 선택된 논문 조회
            const paperIdList = paperIds.split(',').map(id => parseInt(id)).filter(id => !isNaN(id));
            if (paperIdList.length > 0) {
                const placeholders = paperIdList.map(() => '?').join(',');
                const selectedPapers = await query(`
                    SELECT
                        p.id,
                        p.arxiv_id,
                        p.title_ko,
                        p.title_en,
                        p.primary_category as category,
                        p.authors,
                        p.created_at,
                        ps.tldr as summary_ko
                    FROM papers p
                    LEFT JOIN paper_summaries ps ON p.id = ps.paper_id
                    WHERE p.id IN (${placeholders})
                `, paperIdList);
                papers = selectedPapers;
            }
        }

        const emailSubject = subject || `[KoKive] 관심 분야의 새 논문 ${papers.length}편이 등록되었습니다`;
        const baseUrl = process.env.BASE_URL || 'https://kokive.com';

        // 논문 목록 HTML 생성
        const papersHtml = papers.map(paper => `
            <div style="background-color: #27272a; border-radius: 12px; padding: 20px; margin-bottom: 16px; border-left: 4px solid #646cff;">
                <h3 style="color: #ffffff; font-size: 16px; margin: 0 0 8px 0; line-height: 1.4;">
                    <a href="${baseUrl}/paper.html?id=${paper.id}" style="color: #ffffff; text-decoration: none;">
                        ${paper.title_ko || paper.title_en}
                    </a>
                </h3>
                <p style="color: #a1a1aa; font-size: 13px; margin: 0 0 8px 0;">
                    ${(() => {
                        if (!paper.authors) return '';
                        try {
                            // authors가 JSON 배열인 경우 처리
                            if (Array.isArray(paper.authors)) {
                                // 문자열 배열인 경우 (예: ["Author1", "Author2"])
                                if (paper.authors.length > 0 && typeof paper.authors[0] === 'string') {
                                    const names = paper.authors.join(', ');
                                    return names.substring(0, 100) + (names.length > 100 ? '...' : '');
                                }
                                // 객체 배열인 경우 (예: [{name: "Author1"}, ...])
                                const names = paper.authors.map(a => a.name || ((a.firstName || '') + ' ' + (a.lastName || '')).trim()).filter(n => n).join(', ');
                                return names.substring(0, 100) + (names.length > 100 ? '...' : '');
                            }
                            // 문자열인 경우
                            if (typeof paper.authors === 'string') {
                                return paper.authors.substring(0, 100) + (paper.authors.length > 100 ? '...' : '');
                            }
                        } catch(e) {
                            console.error('Authors processing error:', e.message);
                        }
                        return '';
                    })()}
                </p>
                <p style="color: #71717a; font-size: 12px; margin: 0;">
                    ${paper.category || ''} · ${new Date(paper.created_at).toLocaleDateString('ko-KR')}
                </p>
                ${paper.summary_ko ? `
                <p style="color: #a1a1aa; font-size: 14px; line-height: 1.6; margin: 12px 0 0 0;">
                    ${paper.summary_ko.substring(0, 200)}${paper.summary_ko.length > 200 ? '...' : ''}
                </p>
                ` : ''}
            </div>
        `).join('');

        const previewHtml = `
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>뉴스레터 미리보기</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #0a0a0f;">
    <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <!-- Preview Banner -->
        <div style="background: #fef3c7; color: #92400e; padding: 12px 20px; border-radius: 8px; margin-bottom: 20px; text-align: center;">
            ⚠️ 미리보기 모드 - 실제 발송되지 않습니다
        </div>

        <!-- Header -->
        <div style="text-align: center; margin-bottom: 40px;">
            <h1 style="color: #646cff; font-size: 32px; margin: 0;">KoKive</h1>
            <p style="color: #a1a1aa; font-size: 14px; margin-top: 8px;">AI 논문 번역 플랫폼</p>
        </div>

        <!-- Main Content -->
        <div style="background-color: #18181b; border-radius: 16px; padding: 32px; border: 1px solid #27272a;">
            <h2 style="color: #ffffff; font-size: 20px; margin: 0 0 8px 0;">
                📚 ${emailSubject.replace('[KoKive] ', '')}
            </h2>
            <p style="color: #a1a1aa; font-size: 14px; margin: 0 0 24px 0;">
                관심 분야의 새로운 논문 ${papers.length}편을 소개합니다.
            </p>

            <!-- Papers List -->
            ${papersHtml || '<p style="color: #888;">표시할 논문이 없습니다.</p>'}

            <!-- CTA Button -->
            <div style="text-align: center; margin: 32px 0 16px 0;">
                <a href="${baseUrl}/papers.html"
                   style="display: inline-block; background: linear-gradient(135deg, #646cff 0%, #8b5cf6 100%); color: #ffffff; text-decoration: none; padding: 14px 40px; border-radius: 12px; font-size: 14px; font-weight: 600;">
                    더 많은 논문 보기
                </a>
            </div>
        </div>

        <!-- Footer -->
        <div style="text-align: center; margin-top: 32px;">
            <p style="color: #52525b; font-size: 12px; margin: 0;">
                이 이메일은 KoKive 뉴스레터 구독자에게 발송되었습니다.
            </p>
            <p style="color: #52525b; font-size: 12px; margin: 8px 0 0 0;">
                <a href="#" style="color: #646cff; text-decoration: none;">구독 해지</a> ·
                <a href="${baseUrl}/mypage.html" style="color: #646cff; text-decoration: none;">설정 변경</a>
            </p>
            <p style="color: #52525b; font-size: 12px; margin: 8px 0 0 0;">
                © 2024 KoKive. All rights reserved.
            </p>
        </div>
    </div>
</body>
</html>
        `;

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(previewHtml);
    } catch (error) {
        console.error('Newsletter preview error:', error);
        res.status(500).send('<h1>미리보기 생성 실패</h1><p>' + error.message + '</p>');
    }
};

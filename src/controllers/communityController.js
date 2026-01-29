/**
 * KoKive Community Controller
 * Q&A 커뮤니티 관련 비즈니스 로직 (FR-006)
 */

const { query, queryOne, insert, update } = require('../config/database');
const { HTTP_STATUS, ERROR_CODES, VOTE_TARGET_TYPES, PAGINATION } = require('../config/constants');
const aiQnaService = require('../services/aiQnaService');

// ===========================================
// 질문 관련
// ===========================================

/**
 * 질문 목록 조회
 */
exports.getQuestions = async (req, res, next) => {
    try {
        const page = parseInt(req.query.page) || PAGINATION.DEFAULT_PAGE;
        const limit = Math.min(parseInt(req.query.limit) || PAGINATION.DEFAULT_LIMIT, PAGINATION.MAX_LIMIT);
        const offset = (page - 1) * limit;
        const paperId = req.query.paperId;

        let whereClause = '1=1';
        const params = [];

        if (paperId) {
            whereClause += ' AND q.paper_id = ?';
            params.push(paperId);
        }

        // 전체 개수 조회
        const countResult = await queryOne(
            `SELECT COUNT(*) as total FROM questions q WHERE ${whereClause}`,
            params
        );
        const total = countResult?.total || 0;

        // 질문 목록 조회
        const questions = await query(
            `SELECT
                q.id,
                q.paper_id as paperId,
                q.user_id as userId,
                q.title,
                q.content,
                q.view_count as viewCount,
                q.created_at as createdAt,
                q.updated_at as updatedAt,
                u.nickname as authorNickname,
                p.title_ko as paperTitle,
                (SELECT COUNT(*) FROM answers a WHERE a.question_id = q.id) as answerCount,
                (SELECT COUNT(*) FROM answers a WHERE a.question_id = q.id AND a.is_accepted = 1) as hasAcceptedAnswer
            FROM questions q
            LEFT JOIN users u ON q.user_id = u.id
            LEFT JOIN papers p ON q.paper_id = p.id
            WHERE ${whereClause}
            ORDER BY q.created_at DESC
            LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );

        res.json({
            success: true,
            data: {
                questions: questions || [],
                pagination: {
                    page,
                    limit,
                    total,
                    totalPages: Math.ceil(total / limit)
                }
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 질문 상세 조회
 */
exports.getQuestionById = async (req, res, next) => {
    try {
        const { id } = req.params;

        // 질문 조회
        const question = await queryOne(
            `SELECT
                q.id,
                q.paper_id as paperId,
                q.user_id as userId,
                q.title,
                q.content,
                q.view_count as viewCount,
                q.created_at as createdAt,
                q.updated_at as updatedAt,
                u.nickname as authorNickname,
                p.title_ko as paperTitle,
                p.arxiv_id as arxivId
            FROM questions q
            LEFT JOIN users u ON q.user_id = u.id
            LEFT JOIN papers p ON q.paper_id = p.id
            WHERE q.id = ?`,
            [id]
        );

        if (!question) {
            return res.status(HTTP_STATUS.NOT_FOUND).json({
                success: false,
                error: { code: ERROR_CODES.NOT_FOUND, message: 'Question not found' }
            });
        }

        // 조회수 증가
        await query('UPDATE questions SET view_count = view_count + 1 WHERE id = ?', [id]);

        // 사용자 투표 상태 확인 (votes 테이블이 없을 수 있으므로 에러 무시)
        let userVote = null;
        if (req.user) {
            try {
                const vote = await queryOne(
                    'SELECT vote_type FROM votes WHERE user_id = ? AND target_type = ? AND target_id = ?',
                    [req.user.id, VOTE_TARGET_TYPES.QUESTION, id]
                );
                userVote = vote?.vote_type || null;
            } catch {
                // votes table may not exist
            }
        }

        res.json({
            success: true,
            data: {
                ...question,
                userVote
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 질문 등록
 */
exports.createQuestion = async (req, res, next) => {
    try {
        const { paperId, title, content, isPublic = true } = req.body;
        const userId = req.user.id;

        // 논문 존재 확인
        const paper = await queryOne('SELECT id FROM papers WHERE id = ?', [paperId]);
        if (!paper) {
            return res.status(HTTP_STATUS.NOT_FOUND).json({
                success: false,
                error: { code: ERROR_CODES.NOT_FOUND, message: 'Paper not found' }
            });
        }

        const result = await insert('questions', {
            paper_id: paperId,
            user_id: userId,
            title,
            content,
            is_public: isPublic ? 1 : 0
        });

        res.status(HTTP_STATUS.CREATED).json({
            success: true,
            data: { id: result.insertId }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 질문 수정
 */
exports.updateQuestion = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { title, content } = req.body;
        const userId = req.user.id;

        // 질문 존재 및 권한 확인
        const question = await queryOne('SELECT user_id FROM questions WHERE id = ?', [id]);
        if (!question) {
            return res.status(HTTP_STATUS.NOT_FOUND).json({
                success: false,
                error: { code: ERROR_CODES.NOT_FOUND, message: 'Question not found' }
            });
        }

        if (question.user_id !== userId && req.user.role !== 'admin') {
            return res.status(HTTP_STATUS.FORBIDDEN).json({
                success: false,
                error: { code: ERROR_CODES.INSUFFICIENT_PERMISSION, message: 'Permission denied' }
            });
        }

        await update('questions', { title, content }, 'id = ?', [id]);

        res.json({
            success: true,
            data: { id: parseInt(id) }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 질문 삭제
 */
exports.deleteQuestion = async (req, res, next) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        // 질문 존재 및 권한 확인
        const question = await queryOne('SELECT user_id FROM questions WHERE id = ?', [id]);
        if (!question) {
            return res.status(HTTP_STATUS.NOT_FOUND).json({
                success: false,
                error: { code: ERROR_CODES.NOT_FOUND, message: 'Question not found' }
            });
        }

        if (question.user_id !== userId && req.user.role !== 'admin') {
            return res.status(HTTP_STATUS.FORBIDDEN).json({
                success: false,
                error: { code: ERROR_CODES.INSUFFICIENT_PERMISSION, message: 'Permission denied' }
            });
        }

        // 답변이 있는지 확인
        const answerCount = await queryOne('SELECT COUNT(*) as count FROM answers WHERE question_id = ?', [id]);
        if (answerCount?.count > 0) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json({
                success: false,
                error: { code: ERROR_CODES.VALIDATION_ERROR, message: 'Cannot delete question with answers' }
            });
        }

        await query('DELETE FROM questions WHERE id = ?', [id]);

        res.json({
            success: true,
            data: { message: 'Question deleted' }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 질문 투표
 */
exports.voteQuestion = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { voteType } = req.body; // 'up' or 'down'
        const userId = req.user.id;

        // 질문 존재 확인
        const question = await queryOne('SELECT id FROM questions WHERE id = ?', [id]);
        if (!question) {
            return res.status(HTTP_STATUS.NOT_FOUND).json({
                success: false,
                error: { code: ERROR_CODES.NOT_FOUND, message: 'Question not found' }
            });
        }

        // 투표 처리 (votes 테이블이 없을 수 있음)
        try {
            const existingVote = await queryOne(
                'SELECT id, value FROM votes WHERE user_id = ? AND target_type = ? AND target_id = ?',
                [userId, VOTE_TARGET_TYPES.QUESTION, id]
            );

            const voteValue = voteType === 'up' ? 1 : -1;

            if (existingVote) {
                if (existingVote.value === voteValue) {
                    // Cancel same vote
                    await query('DELETE FROM votes WHERE id = ?', [existingVote.id]);
                } else {
                    // Change vote
                    await update('votes', { value: voteValue }, 'id = ?', [existingVote.id]);
                }
            } else {
                // New vote
                await insert('votes', {
                    user_id: userId,
                    target_type: VOTE_TARGET_TYPES.QUESTION,
                    target_id: id,
                    value: voteValue
                });
            }
        } catch {
            // votes table may not exist
        }

        res.json({
            success: true,
            data: { message: 'Vote processed' }
        });
    } catch (error) {
        next(error);
    }
};

// ===========================================
// 답변 관련
// ===========================================

/**
 * 답변 목록 조회
 */
exports.getAnswers = async (req, res, next) => {
    try {
        const { questionId } = req.params;

        const answers = await query(
            `SELECT
                a.id,
                a.question_id as questionId,
                a.user_id as userId,
                a.content,
                a.is_accepted as isAccepted,
                a.is_ai_generated as isAiGenerated,
                a.created_at as createdAt,
                a.updated_at as updatedAt,
                u.nickname as authorNickname
            FROM answers a
            LEFT JOIN users u ON a.user_id = u.id
            WHERE a.question_id = ?
            ORDER BY a.is_accepted DESC, a.created_at ASC`,
            [questionId]
        );

        res.json({
            success: true,
            data: answers || []
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 답변 등록
 */
exports.createAnswer = async (req, res, next) => {
    try {
        const { questionId } = req.params;
        const { content } = req.body;
        const userId = req.user.id;

        // 질문 존재 확인
        const question = await queryOne('SELECT id FROM questions WHERE id = ?', [questionId]);
        if (!question) {
            return res.status(HTTP_STATUS.NOT_FOUND).json({
                success: false,
                error: { code: ERROR_CODES.NOT_FOUND, message: 'Question not found' }
            });
        }

        const result = await insert('answers', {
            question_id: questionId,
            user_id: userId,
            content
        });

        res.status(HTTP_STATUS.CREATED).json({
            success: true,
            data: { id: result.insertId }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 답변 수정
 */
exports.updateAnswer = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { content } = req.body;
        const userId = req.user.id;

        // 답변 존재 및 권한 확인
        const answer = await queryOne('SELECT user_id FROM answers WHERE id = ?', [id]);
        if (!answer) {
            return res.status(HTTP_STATUS.NOT_FOUND).json({
                success: false,
                error: { code: ERROR_CODES.NOT_FOUND, message: 'Answer not found' }
            });
        }

        if (answer.user_id !== userId && req.user.role !== 'admin') {
            return res.status(HTTP_STATUS.FORBIDDEN).json({
                success: false,
                error: { code: ERROR_CODES.INSUFFICIENT_PERMISSION, message: 'Permission denied' }
            });
        }

        await update('answers', { content }, 'id = ?', [id]);

        res.json({
            success: true,
            data: { id: parseInt(id) }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 답변 삭제
 */
exports.deleteAnswer = async (req, res, next) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        // 답변 존재 및 권한 확인
        const answer = await queryOne('SELECT user_id FROM answers WHERE id = ?', [id]);
        if (!answer) {
            return res.status(HTTP_STATUS.NOT_FOUND).json({
                success: false,
                error: { code: ERROR_CODES.NOT_FOUND, message: 'Answer not found' }
            });
        }

        if (answer.user_id !== userId && req.user.role !== 'admin') {
            return res.status(HTTP_STATUS.FORBIDDEN).json({
                success: false,
                error: { code: ERROR_CODES.INSUFFICIENT_PERMISSION, message: 'Permission denied' }
            });
        }

        await query('DELETE FROM answers WHERE id = ?', [id]);

        res.json({
            success: true,
            data: { message: 'Answer deleted' }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 답변 채택
 */
exports.acceptAnswer = async (req, res, next) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        // 답변 조회
        const answer = await queryOne(
            'SELECT a.id, a.question_id, q.user_id as questionUserId FROM answers a JOIN questions q ON a.question_id = q.id WHERE a.id = ?',
            [id]
        );

        if (!answer) {
            return res.status(HTTP_STATUS.NOT_FOUND).json({
                success: false,
                error: { code: ERROR_CODES.NOT_FOUND, message: 'Answer not found' }
            });
        }

        // 질문 작성자만 채택 가능
        if (answer.questionUserId !== userId && req.user.role !== 'admin') {
            return res.status(HTTP_STATUS.FORBIDDEN).json({
                success: false,
                error: { code: ERROR_CODES.INSUFFICIENT_PERMISSION, message: 'Permission denied' }
            });
        }

        // 기존 채택 해제
        await query('UPDATE answers SET is_accepted = 0 WHERE question_id = ?', [answer.question_id]);

        // 새 채택
        await update('answers', { is_accepted: 1 }, 'id = ?', [id]);

        res.json({
            success: true,
            data: { message: 'Answer accepted' }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 답변 투표
 */
exports.voteAnswer = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { voteType } = req.body; // 'up' or 'down'
        const userId = req.user.id;

        // 답변 존재 확인
        const answer = await queryOne('SELECT id FROM answers WHERE id = ?', [id]);
        if (!answer) {
            return res.status(HTTP_STATUS.NOT_FOUND).json({
                success: false,
                error: { code: ERROR_CODES.NOT_FOUND, message: 'Answer not found' }
            });
        }

        // 투표 처리 (votes 테이블이 없을 수 있음)
        try {
            const existingVote = await queryOne(
                'SELECT id, value FROM votes WHERE user_id = ? AND target_type = ? AND target_id = ?',
                [userId, VOTE_TARGET_TYPES.ANSWER, id]
            );

            const voteValue = voteType === 'up' ? 1 : -1;

            if (existingVote) {
                if (existingVote.value === voteValue) {
                    // Cancel same vote
                    await query('DELETE FROM votes WHERE id = ?', [existingVote.id]);
                } else {
                    // Change vote
                    await update('votes', { value: voteValue }, 'id = ?', [existingVote.id]);
                }
            } else {
                // New vote
                await insert('votes', {
                    user_id: userId,
                    target_type: VOTE_TARGET_TYPES.ANSWER,
                    target_id: id,
                    value: voteValue
                });
            }
        } catch {
            // votes table may not exist
        }

        res.json({
            success: true,
            data: { message: 'Vote processed' }
        });
    } catch (error) {
        next(error);
    }
};

// ===========================================
// 논문별 Q&A
// ===========================================

/**
 * 특정 논문의 Q&A 목록
 * 공개 질문 + 본인의 비공개 질문만 표시
 */
exports.getPaperQuestions = async (req, res, next) => {
    try {
        const { paperId } = req.params;
        const page = parseInt(req.query.page) || PAGINATION.DEFAULT_PAGE;
        const limit = Math.min(parseInt(req.query.limit) || PAGINATION.DEFAULT_LIMIT, PAGINATION.MAX_LIMIT);
        const offset = (page - 1) * limit;
        const userId = req.user?.id || null;

        // 논문 존재 확인
        const paper = await queryOne('SELECT id, title_ko as titleKo FROM papers WHERE id = ?', [paperId]);
        if (!paper) {
            return res.status(HTTP_STATUS.NOT_FOUND).json({
                success: false,
                error: { code: ERROR_CODES.NOT_FOUND, message: 'Paper not found' }
            });
        }

        // 공개 질문 + 본인 비공개 질문 조건
        let whereClause = 'q.paper_id = ? AND (q.is_public = 1';
        const params = [paperId];
        if (userId) {
            whereClause += ' OR q.user_id = ?';
            params.push(userId);
        }
        whereClause += ')';

        // 전체 개수 조회
        const countResult = await queryOne(
            `SELECT COUNT(*) as total FROM questions q WHERE ${whereClause}`,
            params
        );
        const total = countResult?.total || 0;

        // 질문 목록 조회
        const questions = await query(
            `SELECT
                q.id,
                q.paper_id as paperId,
                q.user_id as userId,
                q.title,
                q.content,
                q.view_count as viewCount,
                q.is_public as isPublic,
                q.created_at as createdAt,
                q.updated_at as updatedAt,
                u.nickname as authorNickname,
                (SELECT COUNT(*) FROM answers a WHERE a.question_id = q.id) as answerCount,
                (SELECT COUNT(*) FROM answers a WHERE a.question_id = q.id AND a.is_accepted = 1) as hasAcceptedAnswer
            FROM questions q
            LEFT JOIN users u ON q.user_id = u.id
            WHERE ${whereClause}
            ORDER BY q.created_at DESC
            LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );

        // 사용자 정보를 포함한 응답 형식으로 변환
        const formattedQuestions = (questions || []).map(q => ({
            ...q,
            user: {
                nickname: q.authorNickname || '익명'
            }
        }));

        res.json({
            success: true,
            data: {
                paper,
                questions: formattedQuestions,
                pagination: {
                    page,
                    limit,
                    total,
                    totalPages: Math.ceil(total / limit)
                }
            }
        });
    } catch (error) {
        next(error);
    }
};

// ===========================================
// AI Q&A 관련
// ===========================================

/**
 * AI Q&A 설정 조회
 */
exports.getAiQnaSettings = async (req, res, next) => {
    try {
        const settings = await aiQnaService.getAiQnaSettings();
        res.json({
            success: true,
            data: settings
        });
    } catch (error) {
        next(error);
    }
};

/**
 * AI Q&A 설정 업데이트 (관리자용)
 */
exports.updateAiQnaSettings = async (req, res, next) => {
    try {
        const { enabled, model, baseCost, marginPercent, inputCostPer1m, outputCostPer1m } = req.body;

        const updatedSettings = await aiQnaService.updateSettings({
            enabled,
            model,
            baseCost,
            marginPercent,
            inputCostPer1m,
            outputCostPer1m
        });

        res.json({
            success: true,
            data: updatedSettings
        });
    } catch (error) {
        next(error);
    }
};

/**
 * AI 답변 비용 예상
 */
exports.estimateAiAnswerCost = async (req, res, next) => {
    try {
        const { paperId } = req.params;

        const estimate = await aiQnaService.estimateCost(paperId);

        res.json({
            success: true,
            data: estimate
        });
    } catch (error) {
        next(error);
    }
};

/**
 * AI 답변 요청
 */
exports.requestAiAnswer = async (req, res, next) => {
    try {
        const { questionId } = req.params;
        const userId = req.user.id;

        // AI 답변 생성 및 저장
        const result = await aiQnaService.createAiAnswer(parseInt(questionId), userId);

        res.status(HTTP_STATUS.CREATED).json({
            success: true,
            data: {
                answerId: result.answerId,
                pointsDeducted: result.pointsDeducted,
                remainingBalance: result.remainingBalance,
                tokenUsage: result.tokenUsage,
                processingTime: result.processingTime
            }
        });
    } catch (error) {
        // 포인트 부족 등 사용자 에러는 400으로 처리
        if (error.message.includes('포인트') || error.message.includes('비활성화') || error.message.includes('이미')) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json({
                success: false,
                error: { code: ERROR_CODES.VALIDATION_ERROR, message: error.message }
            });
        }
        next(error);
    }
};

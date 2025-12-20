/**
 * KoKive Community Service
 * Q&A 커뮤니티 서비스 (FR-006)
 */

const { query, queryOne, insert, update, transaction } = require('../config/database');

class CommunityService {
    // ==================== 질문 관련 ====================

    /**
     * 질문 생성
     */
    async createQuestion(paperId, userId, data) {
        const { title, content, tags } = data;

        // 논문 존재 확인
        const paper = await queryOne(
            'SELECT id FROM papers WHERE id = ? AND processing_status = ?',
            [paperId, 'completed']
        );

        if (!paper) {
            throw new Error('논문을 찾을 수 없습니다.');
        }

        const questionId = await insert('questions', {
            paper_id: paperId,
            user_id: userId,
            title,
            content,
            tags: tags ? JSON.stringify(tags) : null
        });

        return this.getQuestionById(questionId);
    }

    /**
     * 질문 조회 (단일)
     */
    async getQuestionById(questionId, incrementView = false) {
        if (incrementView) {
            await query(
                'UPDATE questions SET view_count = view_count + 1 WHERE id = ?',
                [questionId]
            );
        }

        const question = await queryOne(`
            SELECT
                q.id,
                q.paper_id,
                q.user_id,
                q.title,
                q.content,
                q.tags,
                q.view_count,
                q.is_answered,
                q.is_pinned,
                q.created_at,
                q.updated_at,
                u.nickname as author_name,
                u.profile_image_url as author_image,
                p.title_ko as paper_title,
                p.arxiv_id,
                (SELECT COUNT(*) FROM answers WHERE question_id = q.id) as answer_count,
                (SELECT COALESCE(SUM(value), 0) FROM votes WHERE target_type = 'question' AND target_id = q.id) as vote_count
            FROM questions q
            JOIN users u ON q.user_id = u.id
            JOIN papers p ON q.paper_id = p.id
            WHERE q.id = ?
        `, [questionId]);

        if (question && question.tags) {
            question.tags = JSON.parse(question.tags);
        }

        return question;
    }

    /**
     * 논문별 질문 목록 조회
     */
    async getQuestionsByPaper(paperId, options = {}) {
        const { page = 1, limit = 20, sort = 'latest' } = options;
        const offset = (page - 1) * limit;

        let orderBy = 'q.created_at DESC';
        if (sort === 'votes') orderBy = 'vote_count DESC, q.created_at DESC';
        else if (sort === 'answers') orderBy = 'answer_count DESC, q.created_at DESC';
        else if (sort === 'unanswered') orderBy = 'q.is_answered ASC, q.created_at DESC';

        const questions = await query(`
            SELECT
                q.id,
                q.title,
                q.content,
                q.tags,
                q.view_count,
                q.is_answered,
                q.is_pinned,
                q.created_at,
                u.nickname as author_name,
                u.profile_image_url as author_image,
                (SELECT COUNT(*) FROM answers WHERE question_id = q.id) as answer_count,
                (SELECT COALESCE(SUM(value), 0) FROM votes WHERE target_type = 'question' AND target_id = q.id) as vote_count
            FROM questions q
            JOIN users u ON q.user_id = u.id
            WHERE q.paper_id = ?
            ORDER BY q.is_pinned DESC, ${orderBy}
            LIMIT ? OFFSET ?
        `, [paperId, limit, offset]);

        const total = await queryOne(
            'SELECT COUNT(*) as count FROM questions WHERE paper_id = ?',
            [paperId]
        );

        return {
            items: questions.map(q => ({
                ...q,
                tags: q.tags ? JSON.parse(q.tags) : [],
                content: q.content.substring(0, 200) + (q.content.length > 200 ? '...' : '')
            })),
            pagination: {
                page,
                limit,
                total: total?.count || 0,
                totalPages: Math.ceil((total?.count || 0) / limit)
            }
        };
    }

    /**
     * 질문 수정
     */
    async updateQuestion(questionId, userId, data) {
        const question = await queryOne(
            'SELECT user_id FROM questions WHERE id = ?',
            [questionId]
        );

        if (!question) {
            throw new Error('질문을 찾을 수 없습니다.');
        }

        if (question.user_id !== userId) {
            throw new Error('수정 권한이 없습니다.');
        }

        const updateData = {};
        if (data.title) updateData.title = data.title;
        if (data.content) updateData.content = data.content;
        if (data.tags !== undefined) updateData.tags = JSON.stringify(data.tags);

        await update('questions', updateData, 'id = ?', [questionId]);

        return this.getQuestionById(questionId);
    }

    /**
     * 질문 삭제
     */
    async deleteQuestion(questionId, userId, isAdmin = false) {
        const question = await queryOne(
            'SELECT user_id FROM questions WHERE id = ?',
            [questionId]
        );

        if (!question) {
            throw new Error('질문을 찾을 수 없습니다.');
        }

        if (question.user_id !== userId && !isAdmin) {
            throw new Error('삭제 권한이 없습니다.');
        }

        await query('DELETE FROM questions WHERE id = ?', [questionId]);

        return { success: true };
    }

    // ==================== 답변 관련 ====================

    /**
     * 답변 생성
     */
    async createAnswer(questionId, userId, data) {
        const { content, isAiGenerated = false } = data;

        // 질문 존재 확인
        const question = await queryOne(
            'SELECT id, user_id FROM questions WHERE id = ?',
            [questionId]
        );

        if (!question) {
            throw new Error('질문을 찾을 수 없습니다.');
        }

        const answerId = await insert('answers', {
            question_id: questionId,
            user_id: userId,
            content,
            is_ai_generated: isAiGenerated
        });

        // 질문 작성자에게 알림 생성
        if (question.user_id !== userId) {
            await insert('notifications', {
                user_id: question.user_id,
                type: 'answer',
                title: '새로운 답변이 등록되었습니다',
                message: content.substring(0, 100),
                link: `/questions/${questionId}`
            });
        }

        return this.getAnswerById(answerId);
    }

    /**
     * 답변 조회 (단일)
     */
    async getAnswerById(answerId) {
        const answer = await queryOne(`
            SELECT
                a.id,
                a.question_id,
                a.user_id,
                a.content,
                a.is_accepted,
                a.is_ai_generated,
                a.created_at,
                a.updated_at,
                u.nickname as author_name,
                u.profile_image_url as author_image,
                (SELECT COALESCE(SUM(value), 0) FROM votes WHERE target_type = 'answer' AND target_id = a.id) as vote_count
            FROM answers a
            JOIN users u ON a.user_id = u.id
            WHERE a.id = ?
        `, [answerId]);

        return answer;
    }

    /**
     * 질문의 답변 목록 조회
     */
    async getAnswersByQuestion(questionId, options = {}) {
        const { page = 1, limit = 50, sort = 'votes' } = options;
        const offset = (page - 1) * limit;

        let orderBy = 'vote_count DESC, a.created_at ASC';
        if (sort === 'latest') orderBy = 'a.created_at DESC';
        else if (sort === 'oldest') orderBy = 'a.created_at ASC';

        const answers = await query(`
            SELECT
                a.id,
                a.question_id,
                a.user_id,
                a.content,
                a.is_accepted,
                a.is_ai_generated,
                a.created_at,
                a.updated_at,
                u.nickname as author_name,
                u.profile_image_url as author_image,
                (SELECT COALESCE(SUM(value), 0) FROM votes WHERE target_type = 'answer' AND target_id = a.id) as vote_count
            FROM answers a
            JOIN users u ON a.user_id = u.id
            WHERE a.question_id = ?
            ORDER BY a.is_accepted DESC, ${orderBy}
            LIMIT ? OFFSET ?
        `, [questionId, limit, offset]);

        const total = await queryOne(
            'SELECT COUNT(*) as count FROM answers WHERE question_id = ?',
            [questionId]
        );

        return {
            items: answers,
            pagination: {
                page,
                limit,
                total: total?.count || 0,
                totalPages: Math.ceil((total?.count || 0) / limit)
            }
        };
    }

    /**
     * 답변 수정
     */
    async updateAnswer(answerId, userId, data) {
        const answer = await queryOne(
            'SELECT user_id FROM answers WHERE id = ?',
            [answerId]
        );

        if (!answer) {
            throw new Error('답변을 찾을 수 없습니다.');
        }

        if (answer.user_id !== userId) {
            throw new Error('수정 권한이 없습니다.');
        }

        await update('answers', { content: data.content }, 'id = ?', [answerId]);

        return this.getAnswerById(answerId);
    }

    /**
     * 답변 삭제
     */
    async deleteAnswer(answerId, userId, isAdmin = false) {
        const answer = await queryOne(
            'SELECT user_id FROM answers WHERE id = ?',
            [answerId]
        );

        if (!answer) {
            throw new Error('답변을 찾을 수 없습니다.');
        }

        if (answer.user_id !== userId && !isAdmin) {
            throw new Error('삭제 권한이 없습니다.');
        }

        await query('DELETE FROM answers WHERE id = ?', [answerId]);

        return { success: true };
    }

    /**
     * 답변 채택
     */
    async acceptAnswer(answerId, userId) {
        // 답변과 질문 정보 가져오기
        const answer = await queryOne(`
            SELECT a.id, a.question_id, a.user_id as answer_user_id, q.user_id as question_user_id
            FROM answers a
            JOIN questions q ON a.question_id = q.id
            WHERE a.id = ?
        `, [answerId]);

        if (!answer) {
            throw new Error('답변을 찾을 수 없습니다.');
        }

        if (answer.question_user_id !== userId) {
            throw new Error('질문 작성자만 답변을 채택할 수 있습니다.');
        }

        // 트랜잭션으로 처리
        await transaction(async (connection) => {
            // 기존 채택 취소
            await connection.execute(
                'UPDATE answers SET is_accepted = FALSE WHERE question_id = ?',
                [answer.question_id]
            );

            // 새 답변 채택
            await connection.execute(
                'UPDATE answers SET is_accepted = TRUE WHERE id = ?',
                [answerId]
            );

            // 질문을 답변 완료로 표시
            await connection.execute(
                'UPDATE questions SET is_answered = TRUE WHERE id = ?',
                [answer.question_id]
            );
        });

        // 답변 작성자에게 알림
        if (answer.answer_user_id !== userId) {
            await insert('notifications', {
                user_id: answer.answer_user_id,
                type: 'answer',
                title: '답변이 채택되었습니다',
                message: '축하합니다! 답변이 채택되었습니다.',
                link: `/questions/${answer.question_id}`
            });
        }

        return this.getAnswerById(answerId);
    }

    // ==================== 투표 관련 ====================

    /**
     * 투표 (질문/답변)
     */
    async vote(userId, targetType, targetId, value) {
        if (!['question', 'answer'].includes(targetType)) {
            throw new Error('잘못된 투표 대상입니다.');
        }

        if (![-1, 1].includes(value)) {
            throw new Error('잘못된 투표 값입니다.');
        }

        // 대상 존재 확인
        const table = targetType === 'question' ? 'questions' : 'answers';
        const target = await queryOne(`SELECT id, user_id FROM ${table} WHERE id = ?`, [targetId]);

        if (!target) {
            throw new Error('투표 대상을 찾을 수 없습니다.');
        }

        // 자신의 글에는 투표 불가
        if (target.user_id === userId) {
            throw new Error('자신의 글에는 투표할 수 없습니다.');
        }

        // 기존 투표 확인
        const existingVote = await queryOne(
            'SELECT id, value FROM votes WHERE user_id = ? AND target_type = ? AND target_id = ?',
            [userId, targetType, targetId]
        );

        if (existingVote) {
            if (existingVote.value === value) {
                // 같은 투표면 취소
                await query('DELETE FROM votes WHERE id = ?', [existingVote.id]);
                return { action: 'removed', value: 0 };
            } else {
                // 다른 투표면 변경
                await update('votes', { value }, 'id = ?', [existingVote.id]);
                return { action: 'changed', value };
            }
        } else {
            // 새 투표
            await insert('votes', {
                user_id: userId,
                target_type: targetType,
                target_id: targetId,
                value
            });
            return { action: 'added', value };
        }
    }

    /**
     * 사용자의 투표 상태 조회
     */
    async getUserVotes(userId, targetType, targetIds) {
        if (!targetIds || targetIds.length === 0) {
            return {};
        }

        const placeholders = targetIds.map(() => '?').join(',');
        const votes = await query(`
            SELECT target_id, value
            FROM votes
            WHERE user_id = ? AND target_type = ? AND target_id IN (${placeholders})
        `, [userId, targetType, ...targetIds]);

        const voteMap = {};
        votes.forEach(v => {
            voteMap[v.target_id] = v.value;
        });

        return voteMap;
    }

    // ==================== 통계 관련 ====================

    /**
     * 논문별 Q&A 통계
     */
    async getPaperStats(paperId) {
        const stats = await queryOne(`
            SELECT
                (SELECT COUNT(*) FROM questions WHERE paper_id = ?) as question_count,
                (SELECT COUNT(*) FROM answers a JOIN questions q ON a.question_id = q.id WHERE q.paper_id = ?) as answer_count,
                (SELECT COUNT(*) FROM questions WHERE paper_id = ? AND is_answered = TRUE) as answered_count
        `, [paperId, paperId, paperId]);

        return {
            questionCount: stats?.question_count || 0,
            answerCount: stats?.answer_count || 0,
            answeredCount: stats?.answered_count || 0,
            answerRate: stats?.question_count > 0
                ? Math.round((stats.answered_count / stats.question_count) * 100)
                : 0
        };
    }

    /**
     * 사용자 활동 통계
     */
    async getUserStats(userId) {
        const stats = await queryOne(`
            SELECT
                (SELECT COUNT(*) FROM questions WHERE user_id = ?) as question_count,
                (SELECT COUNT(*) FROM answers WHERE user_id = ?) as answer_count,
                (SELECT COUNT(*) FROM answers WHERE user_id = ? AND is_accepted = TRUE) as accepted_count,
                (SELECT COALESCE(SUM(value), 0) FROM votes v
                    JOIN questions q ON v.target_type = 'question' AND v.target_id = q.id
                    WHERE q.user_id = ?) as question_votes,
                (SELECT COALESCE(SUM(value), 0) FROM votes v
                    JOIN answers a ON v.target_type = 'answer' AND v.target_id = a.id
                    WHERE a.user_id = ?) as answer_votes
        `, [userId, userId, userId, userId, userId]);

        return {
            questionCount: stats?.question_count || 0,
            answerCount: stats?.answer_count || 0,
            acceptedCount: stats?.accepted_count || 0,
            totalVotes: (stats?.question_votes || 0) + (stats?.answer_votes || 0)
        };
    }

    /**
     * 최근 활동 질문 목록 (전체)
     */
    async getRecentQuestions(options = {}) {
        const { page = 1, limit = 20, category = null } = options;
        const offset = (page - 1) * limit;

        let sql = `
            SELECT
                q.id,
                q.paper_id,
                q.title,
                q.tags,
                q.view_count,
                q.is_answered,
                q.created_at,
                u.nickname as author_name,
                p.title_ko as paper_title,
                p.arxiv_id,
                p.primary_category,
                (SELECT COUNT(*) FROM answers WHERE question_id = q.id) as answer_count,
                (SELECT COALESCE(SUM(value), 0) FROM votes WHERE target_type = 'question' AND target_id = q.id) as vote_count
            FROM questions q
            JOIN users u ON q.user_id = u.id
            JOIN papers p ON q.paper_id = p.id
            WHERE 1=1
        `;
        const params = [];

        if (category) {
            sql += ' AND p.primary_category = ?';
            params.push(category);
        }

        sql += ' ORDER BY q.created_at DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        const questions = await query(sql, params);

        // 전체 개수 조회
        let countSql = `
            SELECT COUNT(*) as count
            FROM questions q
            JOIN papers p ON q.paper_id = p.id
            WHERE 1=1
        `;
        const countParams = [];

        if (category) {
            countSql += ' AND p.primary_category = ?';
            countParams.push(category);
        }

        const total = await queryOne(countSql, countParams);

        return {
            items: questions.map(q => ({
                ...q,
                tags: q.tags ? JSON.parse(q.tags) : []
            })),
            pagination: {
                page,
                limit,
                total: total?.count || 0,
                totalPages: Math.ceil((total?.count || 0) / limit)
            }
        };
    }
}

module.exports = new CommunityService();

/**
 * KoKive Stats Routes
 * 통계 API 엔드포인트
 */

const express = require('express');
const router = express.Router();
const { query, queryOne } = require('../config/database');

/**
 * GET /stats/home
 * 홈페이지 통계
 */
router.get('/home', async (req, res, next) => {
    try {
        // 논문 수
        let papersCount = 0;
        try {
            const papersResult = await queryOne('SELECT COUNT(*) as count FROM papers');
            papersCount = papersResult?.count || 0;
        } catch (e) {}

        // 사용자 수
        let usersCount = 0;
        try {
            const usersResult = await queryOne('SELECT COUNT(*) as count FROM users');
            usersCount = usersResult?.count || 0;
        } catch (e) {}

        // 쇼츠 수
        let shortsCount = 0;
        try {
            const shortsResult = await queryOne("SELECT COUNT(*) as count FROM shorts WHERE status = 'published'");
            shortsCount = shortsResult?.count || 0;
        } catch (e) {}

        // 용어 수
        let termsCount = 0;
        try {
            const termsResult = await queryOne('SELECT COUNT(*) as count FROM terms');
            termsCount = termsResult?.count || 0;
        } catch (e) {}

        res.json({
            success: true,
            data: {
                papers: papersCount,
                users: usersCount,
                shorts: shortsCount,
                terms: termsCount
            }
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;

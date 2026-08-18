export const paginationHelper = (page?: string | number, limit?: string | number) => {
    const currentPage = Math.max(Number(page) || 1, 1);
    const perPage = Math.max(Number(limit) || 10, 1);

    const skip = (currentPage - 1) * perPage;

    return {
        page: currentPage,
        limit: perPage > 100 ? 100 : perPage,
        skip,
    };
};

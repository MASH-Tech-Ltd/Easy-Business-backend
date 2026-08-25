export const paginationHelper = (page?: string | number, limit?: string | number) => {
    const currentPage = Math.max(Number(page) || 1, 1);
    let perPage = Math.max(Number(limit) || 10, 1);
    
    if (perPage > 100) perPage = 100;

    const skip = (currentPage - 1) * perPage;

    return {
        page: currentPage,
        limit: perPage,
        skip,
    };
};

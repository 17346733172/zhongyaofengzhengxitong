"""REST 列表接口共用的分页响应。"""


def page(items, offset, limit):
    return {
        "items": items[offset:offset + limit],
        "total": len(items),
        "offset": offset,
        "limit": limit,
    }

"""匿名处方录入、查询和人工审核接口。"""

from typing import Literal

from fastapi import APIRouter, Query

from .models import PrescriptionCreate, Review
from .pagination import page
from .service import Service, require


def register_prescription_routes(router: APIRouter, service: Service):
    """注册到带有 /api/v1 前缀及统一认证依赖的业务路由。"""

    @router.post(
        "/prescriptions",
        status_code=201,
        tags=["处方"],
        summary="录入匿名仿真处方",
        description="外部系统重试时应复用 external_no。创建后状态为 pending_review，由平台人工审核。",
        responses={409: {"description": "external_no 已存在，错误码为 duplicate_prescription"}},
    )
    def create_prescription(body: PrescriptionCreate):
        return service.create_prescription(body)

    @router.get("/prescriptions", tags=["处方"])
    def prescriptions(
        status: Literal["pending_review", "approved", "rejected"] | None = None,
        offset: int = Query(0, ge=0),
        limit: int = Query(50, ge=1, le=200),
    ):
        items = list(service.store.read()["prescriptions"].values())
        return page([item for item in items if status is None or item["status"] == status], offset, limit)

    @router.get("/prescriptions/{prescription_id}", tags=["处方"])
    def prescription(prescription_id: str):
        return require(service.store.read()["prescriptions"], prescription_id, "处方")

    @router.post("/prescriptions/{prescription_id}/review", tags=["处方"], summary="人工审核通过或驳回")
    def review(prescription_id: str, body: Review):
        return service.review(prescription_id, body)

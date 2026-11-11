"""API contracts: durations in seconds, normal operation uses a real-time 1x clock."""

from enum import StrEnum
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class DeviceKind(StrEnum):
    POT = "pot"
    DISPENSER = "dispenser"
    VERIFICATION = "verification"
    CONVEYOR = "conveyor"
    WATER = "water"
    SOAKING = "soaking"
    DECOCTER = "decocter"
    FILTER = "filter"
    PACKER = "packer"
    LABELER = "labeler"
    QUALITY = "quality"
    DISPATCH = "dispatch"
    RESIDUE = "residue"
    WASHER = "washer"


class Herb(Model):
    name: Text
    grams_per_dose: float | None = Field(default=None, gt=0, le=1000, description="每剂实际克数；片数处方可在审核时补称重")
    unit: Literal["g", "piece"] = Field(default="g", description="g 为克，piece 为片")
    quantity_per_dose: float | None = Field(default=None, gt=0, le=1000000, description="每剂片数，可记录半片等小数")
    method: Literal["normal", "pre_decoct", "late_add", "bag"] = "normal"

    @model_validator(mode="after")
    def validate_quantity(self):
        if self.unit == "g":
            if self.grams_per_dose is None:
                raise ValueError("克单位必须提供每剂克数")
            if self.quantity_per_dose is not None:
                raise ValueError("克单位不接受片数字段")
        elif self.quantity_per_dose is None:
            raise ValueError("片单位必须提供每剂片数")
        return self


class Recipe(Model):
    soak_seconds: float = Field(default=300, ge=1, le=14400)
    pre_decoct_seconds: float = Field(default=900, ge=1, le=7200)
    heat_seconds: float = Field(default=0, ge=0, le=3600, description="默认并入煎煮，不额外占用升温时间")
    first_decoct_seconds: float = Field(default=900, ge=1, le=7200)
    second_decoct_seconds: float = Field(default=900, ge=0, le=7200)
    late_add_seconds: float = Field(default=300, ge=1, le=3600)
    target_temperature_c: float = Field(default=96, ge=70, le=100)
    water_ml_per_g: float = Field(default=8, ge=1, le=30)
    evaporation_ml_per_minute: float = Field(default=5, ge=0, le=100)


class PrescriptionCreate(Model):
    external_no: Text = Field(description="外部处方唯一编号，调用方重试时应复用同一编号")
    patient_code: Text = Field(description="仿真匿名编号，请勿录入真实患者信息")
    doses: int = Field(default=3, ge=1, le=30)
    bags_per_dose: int = Field(default=2, ge=1, le=4)
    bag_volume_ml: int = Field(default=200, ge=50, le=500)
    priority: int = Field(default=0, ge=0, le=10)
    herbs: list[Herb] = Field(min_length=1, max_length=100)
    recipe: Recipe = Field(default_factory=Recipe)
    note: str = Field(default="", max_length=1000)

    @model_validator(mode="after")
    def validate_herbs(self):
        names = [h.name for h in self.herbs]
        if len(set(names)) != len(names):
            raise ValueError("同一药材请合并为一条记录")
        if any(h.method == "late_add" for h in self.herbs):
            if self.recipe.late_add_seconds >= self.recipe.first_decoct_seconds:
                raise ValueError("后下时长必须小于一煎时长")
        return self


class Review(Model):
    approved: bool
    operator: Text
    comment: str = Field(default="", max_length=1000)
    herb_grams_per_dose: dict[Text, Annotated[float, Field(gt=0, le=1000)]] = Field(
        default_factory=dict, max_length=100, description="按药名补充计数饮片的每剂实测克数，不改变原始片数")


class BatchCreate(Model):
    prescription_id: Text


class DeviceCreate(Model):
    name: Text
    kind: DeviceKind
    capacity_ml: int = Field(default=30000, ge=100, le=1000000)


class OperatorAction(Model):
    operator: Text = "演示操作员"
    reason: str = Field(default="人工操作", min_length=1, max_length=500)


class ClockStep(Model):
    seconds: float = Field(gt=0, le=86400)


class ClockStart(Model):
    speed: float = Field(default=1, ge=1, le=1, description="固定真实时间1倍速")


class ScenarioCreate(Model):
    count: int = Field(default=5, ge=1, le=50)

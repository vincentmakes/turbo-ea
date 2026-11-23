from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

LIFECYCLE_STAGE_KEY_PATTERN = r"^[A-Za-z][A-Za-z0-9_]*$"


class LifecycleStage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    key: str = Field(min_length=1, max_length=50, pattern=LIFECYCLE_STAGE_KEY_PATTERN)
    label: str = Field(min_length=1, max_length=200)
    color: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")

    @field_validator("label")
    @classmethod
    def label_must_not_be_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Lifecycle stage label must not be blank")
        return value


class LifecycleStagesUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    stages: list[LifecycleStage] = Field(max_length=50)

    @model_validator(mode="after")
    def unique_keys(self):
        keys = [stage.key for stage in self.stages]
        if len(keys) != len(set(keys)):
            raise ValueError("Lifecycle stage keys must be unique")
        return self


class LifecycleStagesResponse(BaseModel):
    lifecycle_stages: list[LifecycleStage]

import { useEffect, useState } from "react";
import { Alert, Button, Form, Input, InputNumber, Modal, Select, Space, Tag, message } from "antd";
import { MinusCircleOutlined, PlusOutlined } from "@ant-design/icons";
import { api } from "../api/client";
import { HERB_METHOD_LABELS } from "../domain/labels";

const { TextArea } = Input;

/** 工艺参数默认值与 backend/app/models.py 的 Recipe 保持一致 */
const RECIPE_DEFAULTS = {
  soak_seconds: 300,
  pre_decoct_seconds: 900,
  heat_seconds: 0,
  first_decoct_seconds: 900,
  second_decoct_seconds: 900,
  late_add_seconds: 300,
  target_temperature_c: 96,
  water_ml_per_g: 8,
  evaporation_ml_per_minute: 5,
};

const RECIPE_FIELDS = [
  { name: "soak_seconds", label: "浸泡时长", min: 1, max: 14400, unit: "s" },
  { name: "pre_decoct_seconds", label: "先煎时长", min: 1, max: 7200, unit: "s" },
  { name: "heat_seconds", label: "额外升温时长", min: 0, max: 3600, unit: "s", hint: "默认 0，升温并入 15 分钟煎煮，不额外计时" },
  { name: "first_decoct_seconds", label: "一煎时长", min: 1, max: 7200, unit: "s" },
  { name: "second_decoct_seconds", label: "二煎时长", min: 0, max: 7200, unit: "s", hint: "为 0 时跳过二煎" },
  { name: "late_add_seconds", label: "后下提前量", min: 1, max: 3600, unit: "s", hint: "必须小于一煎时长" },
  { name: "target_temperature_c", label: "目标温度", min: 70, max: 100, unit: "℃" },
  { name: "water_ml_per_g", label: "吸水系数", min: 1, max: 30, unit: "ml/g" },
  { name: "evaporation_ml_per_minute", label: "蒸发速率", min: 0, max: 100, unit: "ml/min" },
];

/**
 * 匿名处方录入。字段与校验规则对齐 backend/app/models.py 的 PrescriptionCreate：
 * 药材不可重名；存在后下药组时 late_add_seconds 必须小于 first_decoct_seconds。
 */
export function PrescriptionForm({ open, onClose, onCreated }) {
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      form.resetFields();
      form.setFieldsValue({
        doses: 3, bags_per_dose: 2, bag_volume_ml: 200, priority: 0,
        herbs: [{ name: "", unit: "g", grams_per_dose: 10, method: "normal" }],
        recipe: { ...RECIPE_DEFAULTS },
      });
    }
  }, [open, form]);

  const submit = async () => {
    let values;
    try {
      values = await form.validateFields();
    } catch {
      message.warning("请先修正表单中的错误");
      return;
    }
    // 与后端一致：同名药材必须合并为一条；药组被删空时阻止提交
    const herbs = values.herbs || [];
    if (herbs.length === 0) {
      message.error("至少需要一条药材");
      return;
    }
    const names = herbs.map((h) => h.name.trim());
    if (new Set(names).size !== names.length) {
      message.error("同一药材请合并为一条记录");
      return;
    }
    // 与 PrescriptionCreate.validate_herbs 一致：有后下组时提前量必须小于一煎时长
    if (herbs.some((h) => h.method === "late_add")) {
      const recipe = values.recipe || {};
      if ((recipe.late_add_seconds ?? 0) >= (recipe.first_decoct_seconds ?? 0)) {
        message.error("后下时长必须小于一煎时长");
        return;
      }
    }
    setSubmitting(true);
    try {
      const created = await api.createPrescription(values);
      message.success(`处方 ${created.external_no} 已录入，等待人工审核`);
      onCreated?.(created);
      onClose?.();
    } catch (error) {
      message.error(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title="录入匿名仿真处方" open={open} onCancel={onClose} width={760} footer={null} destroyOnClose>
      <Alert className="banner" type="warning" showIcon
             message="请使用匿名编号与虚构饮片名称，不要录入真实患者信息。" />
      <Form form={form} layout="vertical" style={{ marginTop: 14 }} requiredMark={false}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0 14px" }}>
          <Form.Item name="external_no" label="处方外部编号" rules={[
            { required: true, message: "请输入外部编号" },
            { max: 100, message: "最长 100 字符" },
          ]}>
            <Input placeholder="如 RX-2026-0001" maxLength={100} />
          </Form.Item>
          <Form.Item name="patient_code" label="匿名编号" rules={[
            { required: true, message: "请输入匿名编号" },
            { max: 100, message: "最长 100 字符" },
          ]}>
            <Input placeholder="如 SIM-001" maxLength={100} />
          </Form.Item>
          <Form.Item name="doses" label="剂数" rules={[{ required: true }]}>
            <InputNumber min={1} max={30} precision={0} style={{ width: "100%" }} addonAfter="剂" />
          </Form.Item>
          <Form.Item name="bags_per_dose" label="每剂袋数" rules={[{ required: true }]}>
            <InputNumber min={1} max={4} precision={0} style={{ width: "100%" }} addonAfter="袋" />
          </Form.Item>
          <Form.Item name="bag_volume_ml" label="每袋容量" rules={[{ required: true }]}>
            <InputNumber min={50} max={500} step={10} precision={0} style={{ width: "100%" }} addonAfter="ml" />
          </Form.Item>
          <Form.Item name="priority" label="优先级" tooltip="数值越大越先调度，同优先级按创建顺序">
            <InputNumber min={0} max={10} precision={0} style={{ width: "100%" }} />
          </Form.Item>
        </div>

        <div className="section-head" style={{ marginTop: 4 }}>
          <span className="section-title">药组构成 · 至少一条</span>
          <span className="notice">同名药材请合并为一条记录</span>
        </div>
        <Form.List name="herbs" rules={[{ required: true, message: "至少需要一条药材" }]}>
          {(fields, { add, remove }) => (
            <>
              {fields.map(({ key, name, ...rest }) => (
                <Space key={key} align="baseline" style={{ display: "flex", marginBottom: 8 }} wrap>
                  <Form.Item {...rest} name={[name, "name"]} noStyle
                             rules={[{ required: true, message: "药材名称" }, { max: 100 }]}>
                    <Input placeholder="饮片名称" style={{ width: 200 }} maxLength={100} />
                  </Form.Item>
                  <Form.Item {...rest} name={[name, "unit"]} noStyle>
                    <Select aria-label={`第${name + 1}味单位`} style={{ width: 80 }} options={[{ value: "g", label: "克" }, { value: "piece", label: "片" }]}
                            onChange={() => { form.setFieldValue(["herbs", name, "grams_per_dose"], undefined); form.setFieldValue(["herbs", name, "quantity_per_dose"], undefined); }} />
                  </Form.Item>
                  <Form.Item noStyle shouldUpdate={(previous, current) => previous.herbs?.[name]?.unit !== current.herbs?.[name]?.unit}>
                    {() => {
                      const piece = form.getFieldValue(["herbs", name, "unit"]) === "piece";
                      return <Form.Item {...rest} name={[name, piece ? "quantity_per_dose" : "grams_per_dose"]} noStyle preserve={false}
                                        rules={[{ required: true, message: piece ? "请填写每剂片数" : "请填写每剂克数" }]}>
                        <InputNumber aria-label={`第${name + 1}味每剂数量`} min={0.000001} max={piece ? 1000000 : 1000} precision={6} style={{ width: 150 }} addonAfter={piece ? "片/剂" : "g/剂"} />
                      </Form.Item>;
                    }}
                  </Form.Item>
                  <Form.Item {...rest} name={[name, "method"]} noStyle>
                    <Select style={{ width: 120 }} options={Object.entries(HERB_METHOD_LABELS).map(([v, l]) => ({ value: v, label: l }))} />
                  </Form.Item>
                  <MinusCircleOutlined onClick={() => remove(name)} style={{ color: "var(--bad)" }} />
                </Space>
              ))}
              <Button type="dashed" onClick={() => add({ method: "normal", unit: "g", grams_per_dose: 10 })} block icon={<PlusOutlined />}>
                添加药材
              </Button>
            </>
          )}
        </Form.List>

        <div className="section-head" style={{ marginTop: 18 }}>
          <span className="section-title">工艺参数 · 演示假设，非临床建议</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0 14px" }}>
          {RECIPE_FIELDS.map((f) => (
            <Form.Item key={f.name} name={["recipe", f.name]} label={f.label} tooltip={f.hint} rules={[{ required: true }]}
                       getValueProps={f.unit === "s" ? (seconds) => ({ value: seconds == null ? seconds : seconds / 60 }) : undefined}
                       normalize={f.unit === "s" ? (minutes) => minutes == null ? minutes : Math.round(minutes * 60 * 1000000) / 1000000 : undefined}>
              <InputNumber min={f.unit === "s" ? f.min / 60 : f.min} max={f.unit === "s" ? f.max / 60 : f.max}
                           style={{ width: "100%" }} addonAfter={f.unit === "s" ? "分钟" : f.unit} />
            </Form.Item>
          ))}
        </div>

        <Form.Item name="note" label="备注">
          <TextArea rows={2} maxLength={1000} showCount placeholder="可选" />
        </Form.Item>

        <Form.Item style={{ marginBottom: 0, textAlign: "right" }}>
          <Space>
            <Button onClick={onClose}>取消</Button>
            <Button type="primary" loading={submitting} onClick={submit}>录入处方</Button>
          </Space>
        </Form.Item>
      </Form>
    </Modal>
  );
}

/** 审核弹窗。operator 为必填，approved 决定通过或驳回。 */
export function ReviewForm({ prescription, open, onClose, onDone }) {
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const approved = Form.useWatch("approved", form);

  useEffect(() => {
    if (open) {
      form.resetFields();
      form.setFieldsValue({ approved: true, operator: "", comment: "",
        herb_grams_per_dose: Object.fromEntries((prescription.herbs || []).filter(h => h.unit === "piece" && h.grams_per_dose != null).map(h => [h.name, h.grams_per_dose])) });
    }
  }, [open, form, prescription.id]);

  const submit = async () => {
    let values;
    try {
      values = await form.validateFields();
    } catch {
      return; // antd 已在字段上标出错误，这里不再重复提示
    }
    setSubmitting(true);
    try {
      await api.review(prescription.id, { ...values, herb_grams_per_dose: values.approved ? values.herb_grams_per_dose || {} : {} });
      message.success(values.approved ? "已审核通过" : "已驳回");
      onDone?.();
      onClose?.();
    } catch (error) {
      message.error(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title={`审核处方 ${prescription.external_no}`} open={open} onCancel={onClose} onOk={submit}
           confirmLoading={submitting} okText="提交审核" okButtonProps={{ danger: !approved }}>
      <Form form={form} layout="vertical">
        <Form.Item name="approved" label="审核结论" rules={[{ required: true }]}>
          <Select options={[
            { value: true, label: "通过（可创建批次）" },
            { value: false, label: "驳回" },
          ]} />
        </Form.Item>
        {(prescription.herbs || []).filter(h => h.unit === "piece").map(h => (
          <Form.Item key={h.name} name={["herb_grams_per_dose", h.name]} label={`${h.name}：${h.quantity_per_dose}片/剂，实测重量（g/剂）`}
                     extra="填写每一剂中这些片数的实际总重量，保留原片数，不按每片默认换算。"
                     rules={[{ required: approved, message: "审核通过前请补充每剂实测克数" }]}>
            <InputNumber aria-label={`${h.name}每剂实测克数`} disabled={!approved} min={0.000001} max={1000} precision={6} style={{ width: "100%" }} addonAfter="g/剂" />
          </Form.Item>
        ))}
        <Form.Item name="operator" label="操作人" rules={[{ required: true, message: "请输入操作人" }, { max: 100 }]}>
          <Input maxLength={100} placeholder="演示操作员" />
        </Form.Item>
        <Form.Item name="comment" label="审核意见">
          <Input.TextArea rows={3} maxLength={1000} showCount />
        </Form.Item>
      </Form>
      <Alert className="banner" type="info" showIcon
             message="本平台不执行配伍、禁忌或临床剂量判断，审核仅作为流程演示。" />
    </Modal>
  );
}

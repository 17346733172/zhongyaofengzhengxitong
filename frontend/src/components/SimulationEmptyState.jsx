import { Alert } from "antd";
import { Link } from "react-router-dom";

export function SimulationEmptyState() {
  return (
    <Alert className="simulation-empty" type="info" showIcon
           message="还没有仿真批次，设备正在待工"
           description={
             <>
               在上方点击「生成演示数据」创建匿名处方和批次，再点击「开始」按真实时间观察设备状态与进度。
               也可以前往 <Link to="/prescriptions">处方页</Link>录入处方，审核后创建批次。
             </>
           } />
  );
}

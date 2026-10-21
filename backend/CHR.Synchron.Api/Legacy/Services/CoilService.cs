// ทะเบียน Coil (CIMS.Coils) - Coil ลูก / Master Coil / น้ำหนัก KG ของแต่ละสินค้าในคลังที่นับ Coil
using CIMS.Core;
using CIMS.Helpers;
using CIMS.Models;
using Microsoft.Data.SqlClient;
using System;
using System.Collections.Generic;
using System.Linq;

namespace CIMS.Services
{
    public class CoilService
    {
        // Coil ที่อยู่ในคลัง (Status = IN) ของสินค้า 1 ตัว -> เรียงตาม Master Coil แล้วเลข Coil ลูก
        // คืนเป็นแถวพร้อมแสดง: หัวกลุ่ม Master Coil (IsMother) ตามด้วย Coil ลูกในกลุ่มนั้น
        public List<CoilRowModel> GetCoilRows(int stockId, int partId)
        {
            var coils = GetCoils(stockId, partId);
            var rows = new List<CoilRowModel>();
            foreach (var g in coils.GroupBy(c => string.IsNullOrWhiteSpace(c.MotherCoil) ? "-" : c.MotherCoil))
            {
                var list = g.ToList();
                rows.Add(new CoilRowModel
                {
                    IsMother = true,
                    MotherCoil = g.Key,
                    CoilNo = $"{list.Count} COIL",
                    WeightKG = list.Sum(c => c.WeightKG)
                });
                int no = 1;
                foreach (var c in list) { c.No = no++; rows.Add(c); }
            }
            return rows;
        }

        // partId = 0 -> ทุกสินค้าในคลัง (ใช้ตอน Export)
        public List<CoilRowModel> GetCoils(int stockId, int partId)
        {
            var list = new List<CoilRowModel>();
            if (!DbSchema.HasCoilRegister || stockId <= 0 || partId < 0) return list;

            using (var conn = new SqlConnection(GlobalConfig.ConnStr))
            using (var cmd = new SqlCommand(@"
                SELECT CoilID, PartID, CoilNo, MotherCoil, WeightKG, LabelDate, ReceivedDate
                FROM CIMS.Coils
                WHERE StockID = @stk AND (@pt = 0 OR PartID = @pt) AND Status = 'IN'
                ORDER BY PartID, ISNULL(MotherCoil, N''), CoilNo", conn))
            {
                cmd.Parameters.AddWithValue("@stk", stockId);
                cmd.Parameters.AddWithValue("@pt", partId);
                conn.Open();
                using (var rdr = cmd.ExecuteReader())
                {
                    while (rdr.Read())
                    {
                        list.Add(new CoilRowModel
                        {
                            CoilId = Convert.ToInt32(rdr["CoilID"]),
                            PartId = Convert.ToInt32(rdr["PartID"]),
                            CoilNo = rdr["CoilNo"].ToString(),
                            MotherCoil = rdr["MotherCoil"] == DBNull.Value ? null : rdr["MotherCoil"].ToString(),
                            WeightKG = rdr["WeightKG"] == DBNull.Value ? 0 : Convert.ToDecimal(rdr["WeightKG"]),
                            LabelDate = rdr["LabelDate"] == DBNull.Value ? null : rdr["LabelDate"].ToString(),
                            ReceivedDate = rdr["ReceivedDate"] == DBNull.Value ? (DateTime?)null : Convert.ToDateTime(rdr["ReceivedDate"])
                        });
                    }
                }
            }
            return list;
        }

        // จำนวน Coil ที่ลงทะเบียนไว้ต่อสินค้า (ใช้บอกว่าแถวไหนกดดู Coil ได้)
        public Dictionary<int, int> CountByPart(int stockId)
        {
            var map = new Dictionary<int, int>();
            if (!DbSchema.HasCoilRegister || stockId <= 0) return map;

            using (var conn = new SqlConnection(GlobalConfig.ConnStr))
            using (var cmd = new SqlCommand("SELECT PartID, COUNT(*) FROM CIMS.Coils WHERE StockID = @stk AND Status = 'IN' GROUP BY PartID", conn))
            {
                cmd.Parameters.AddWithValue("@stk", stockId);
                conn.Open();
                using (var rdr = cmd.ExecuteReader())
                    while (rdr.Read()) map[rdr.GetInt32(0)] = rdr.GetInt32(1);
            }
            return map;
        }

        // 🧲 ยอด Coil ในคลัง (Status IN): MASTER COIL = ม้วนที่ไม่ได้ตัดมาจาก Coil อื่น (MASTER COIL ว่าง / เท่ากับตัวเอง)
        //    COIL NO = ม้วนลูกที่ตัดมาจาก Master Coil - คืนทุกคลังที่มี Coil (StockID -> ยอด)
        public class CoilSummary
        {
            public int MasterCount { get; set; }
            public decimal MasterKg { get; set; }
            public int ChildCount { get; set; }
            public decimal ChildKg { get; set; }
            public int TotalCount => MasterCount + ChildCount;
            public decimal TotalKg => MasterKg + ChildKg;
        }

        public Dictionary<int, CoilSummary> GetSummary(int? stockId = null)
        {
            var map = new Dictionary<int, CoilSummary>();
            if (!DbSchema.HasCoilRegister) return map;
            using (var conn = new SqlConnection(GlobalConfig.ConnStr))
            using (var cmd = new SqlCommand(@"
                SELECT StockID,
                       SUM(CASE WHEN m = 1 THEN 1 ELSE 0 END), ISNULL(SUM(CASE WHEN m = 1 THEN WeightKG END), 0),
                       SUM(CASE WHEN m = 0 THEN 1 ELSE 0 END), ISNULL(SUM(CASE WHEN m = 0 THEN WeightKG END), 0)
                FROM (SELECT StockID, WeightKG,
                             CASE WHEN ISNULL(LTRIM(RTRIM(MotherCoil)), '') IN ('', '-') OR MotherCoil = CoilNo THEN 1 ELSE 0 END AS m
                      FROM CIMS.Coils WHERE Status = 'IN' AND (@stk IS NULL OR StockID = @stk)) x
                GROUP BY StockID", conn))
            {
                cmd.Parameters.AddWithValue("@stk", (object)stockId ?? DBNull.Value);
                conn.Open();
                using (var r = cmd.ExecuteReader())
                    while (r.Read())
                        map[r.GetInt32(0)] = new CoilSummary
                        {
                            MasterCount = r.GetInt32(1), MasterKg = r.GetDecimal(2),
                            ChildCount = r.GetInt32(3), ChildKg = r.GetDecimal(4)
                        };
            }
            return map;
        }
    }
}

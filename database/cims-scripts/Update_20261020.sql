-- Update_20261020.sql
--   * CIMS.Stocks.NotSetButton: Store (Max-Min) shows the 3rd status button as "MAX-MIN NOT SET" instead of "NO ORDER"
--     (same list: items in neither MAX nor MIN). Set in ADD / EDIT STOCK. STOCK-MAT and STOCK-PANTA start with it on.
--   * CIMS.sp_GetPartForQR (Inventory Registration list): the search also finds products by COIL NO / MASTER COIL
--     of the coils in stock (in the filtered stock, or any stock when ALL STOCKS).
-- Adds one column and changes one procedure - other data is not changed. Safe to run again.

IF COL_LENGTH('CIMS.Stocks', 'NotSetButton') IS NULL
    ALTER TABLE CIMS.Stocks ADD NotSetButton BIT NOT NULL CONSTRAINT DF_Stocks_NotSetButton DEFAULT 0;
GO

UPDATE CIMS.Stocks SET NotSetButton = 1 WHERE StockCode IN (N'STOCK-MAT', N'STOCK-PANTA') AND NotSetButton = 0;
GO

-- @StkId: show only the parts in that stock (main = IsShowInMaster / other = row in CIMS.PartStocks), NULL = all
CREATE OR ALTER PROCEDURE CIMS.sp_GetPartForQR
    @SearchText NVARCHAR(100) = '',
    @StkId INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET @SearchText = ISNULL(TRIM(@SearchText), '');
    DECLARE @isMain BIT = ISNULL((SELECT IsMain FROM CIMS.Stocks WHERE StockID = @StkId), 0);
    DECLARE @like NVARCHAR(110) = '%' + @SearchText + '%';

    -- IS_SHOW_VIEW: SHOW/HIDE of the filtered stock (other stock = CIMS.PartStocks.IsShow / main or all = IsShowInMaster)
    SELECT v.*,
           CASE WHEN @StkId IS NOT NULL AND @isMain = 0
                THEN ISNULL((SELECT ps.IsShow FROM CIMS.PartStocks ps WHERE ps.StockID = @StkId AND ps.PartID = v.PartID), 1)
                ELSE v.IsShowInMaster END AS IS_SHOW_VIEW
    FROM CIMS.vw_PartQRReady v
    WHERE
        (@StkId IS NULL
         OR (@isMain = 1 AND v.IsShowInMaster = 1)
         OR (@isMain = 0 AND EXISTS (SELECT 1 FROM CIMS.PartStocks ps WHERE ps.StockID = @StkId AND ps.PartID = v.PartID)))
    AND (
        @SearchText = ''
        OR (
            ISNULL(PartCode, '')        LIKE @like
            OR ISNULL(Description, '')  LIKE @like
            OR ISNULL(Supplier, '')     LIKE @like
            OR ISNULL(Bin, '')          LIKE @like
            OR ISNULL(Category, '')     LIKE @like
            OR ISNULL(Customer, '')     LIKE @like
            OR ISNULL(PartA, '')        LIKE @like
            OR ISNULL(PartB, '')        LIKE @like
            OR ISNULL(PartNumber, '')   LIKE @like
            OR ISNULL(Model, '')        LIKE @like
            -- COIL NO / MASTER COIL of the coils in stock
            OR EXISTS (SELECT 1 FROM CIMS.Coils c
                       WHERE c.PartID = v.PartID AND c.Status = 'IN' AND (@StkId IS NULL OR c.StockID = @StkId)
                         AND (c.CoilNo LIKE @like OR ISNULL(c.MotherCoil, '') LIKE @like))
        )
    )
    ORDER BY Category ASC, PartCode ASC
    OPTION (MAX_GRANT_PERCENT = 5);   -- small memory grant: does not wait behind other queries (SQL Express)
END
GO

SELECT StockCode, NotSetButton FROM CIMS.Stocks ORDER BY SortNo;

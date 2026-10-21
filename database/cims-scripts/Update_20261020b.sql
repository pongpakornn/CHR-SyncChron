-- Update_20261020b.sql
--   * Multi-Scanner: EMPLOYEE ID + DEPARTMENT on the scan page
--       CIMS.UserScanStocks.AskEmployee / AskDepartment = which stocks of a user ask for them (PERMISSION > SCAN STOCKS)
--       CIMS.ScanTransactions.EmployeeID / Department    = what was typed / chosen when the item was scanned
--       CIMS.ScanDepartments                             = the DEPARTMENT dropdown list (User Management > SETUP > DEPARTMENTS)
--   * CIMS.ScanRpaLayouts: EXCEL SETUP > MULTI-SCANNER (RPA) - Excel file of each stock + where each scan field goes,
--     which day is exported, and how it is written (continue below the last row, or add a new sheet from the template sheet)
-- Adds columns / tables only - other data is not changed. Safe to run again.

IF COL_LENGTH('CIMS.UserScanStocks', 'AskEmployee') IS NULL
    ALTER TABLE CIMS.UserScanStocks ADD AskEmployee BIT NOT NULL CONSTRAINT DF_UserScanStocks_AskEmployee DEFAULT 0;
GO
IF COL_LENGTH('CIMS.UserScanStocks', 'AskDepartment') IS NULL
    ALTER TABLE CIMS.UserScanStocks ADD AskDepartment BIT NOT NULL CONSTRAINT DF_UserScanStocks_AskDepartment DEFAULT 0;
GO

IF COL_LENGTH('CIMS.ScanTransactions', 'EmployeeID') IS NULL
    ALTER TABLE CIMS.ScanTransactions ADD EmployeeID NVARCHAR(30) NULL;
GO
IF COL_LENGTH('CIMS.ScanTransactions', 'Department') IS NULL
    ALTER TABLE CIMS.ScanTransactions ADD Department NVARCHAR(100) NULL;
GO

IF OBJECT_ID('CIMS.ScanDepartments', 'U') IS NULL
    CREATE TABLE CIMS.ScanDepartments (
        DepartmentID   INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ScanDepartments PRIMARY KEY,
        DepartmentName NVARCHAR(100) NOT NULL CONSTRAINT UQ_ScanDepartments_Name UNIQUE,
        SortNo         INT NOT NULL CONSTRAINT DF_ScanDepartments_SortNo DEFAULT 0,
        UpdatedBy      VARCHAR(20) NULL,
        UpdatedDate    DATETIME NOT NULL CONSTRAINT DF_ScanDepartments_UpdatedDate DEFAULT GETDATE()
    );
GO

-- WriteMode: APPEND = continue below the last row of the sheet / SHEET = copy the template sheet to a new sheet (SheetName, {DATE} = the day)
-- DateMode : PICK = ask which day when pressing EXPORT RPA / TODAY = always today / FILTER = the FROM - TO of the HISTORY window
-- TxTypes  : which scans go to the file (OUT / IN / RETURN, comma separated - empty = all)
IF OBJECT_ID('CIMS.ScanRpaLayouts', 'U') IS NULL
    CREATE TABLE CIMS.ScanRpaLayouts (
        StockID       INT NOT NULL CONSTRAINT PK_ScanRpaLayouts PRIMARY KEY,
        ExportPath    NVARCHAR(500) NULL,
        ExcelMap      NVARCHAR(MAX) NULL,
        StartRow      INT NOT NULL CONSTRAINT DF_ScanRpaLayouts_StartRow DEFAULT 2,
        WriteMode     VARCHAR(10) NOT NULL CONSTRAINT DF_ScanRpaLayouts_WriteMode DEFAULT 'APPEND',
        TemplateSheet NVARCHAR(100) NULL,
        SheetName     NVARCHAR(100) NULL,
        DateMode      VARCHAR(10) NOT NULL CONSTRAINT DF_ScanRpaLayouts_DateMode DEFAULT 'PICK',
        TxTypes       VARCHAR(50) NULL,
        UpdatedBy     VARCHAR(20) NULL,
        UpdatedDate   DATETIME NOT NULL CONSTRAINT DF_ScanRpaLayouts_UpdatedDate DEFAULT GETDATE()
    );
GO

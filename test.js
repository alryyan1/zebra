import Printer from "node-printer";
import { getPrinters } from "printer";
import { printDirect } from "printer";
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
const app = express();
app.use(express.json());
app.use(cors());

const barcode = (
  x,
  y,
  rotation,
  barcodeSelection,
  narrowBarcodeWidth,
  WideBarcodeWidth,
  height,
  printHuman,
  data
) => {
  return `B${x},${y},${rotation},${barcodeSelection},${narrowBarcodeWidth},${WideBarcodeWidth},${height},${printHuman},"${data}"`;
};

const printLabel = (patientObj) => {
  const printerName = "ZDesigner GC420t";
  const fullname = patientObj.name;
  const visitNo = patientObj.visit_number;
  const pid = patientObj.id;
  const tests = "cbc-Ha1c";
  console.log(fullname,visitNo,pid,'fullname visitno')
  const zplCommand = `N
  q400
  l200
  P1
  S4d
  D10
  R0
  A15,15,0,3,1,1,R,"${visitNo}"
  A60,15,0,3,1,1,N,"${fullname}"
  ${barcode(60, 40, 0, 1, 2, 3, 60, "B", pid)}
  P`;
  console.log(zplCommand,'zplcommand')
  printDirect({
    data: zplCommand,
    printer: printerName,
    type: "RAW",
    success: function (jobID) {
      console.log(`Printed with job ID: ${jobID}`);
    },
    error: function (err) {
      console.error(`Error printing: ${err}`);
    },
  });
};
app.post("/", function (req, res) {
 // res.send("Hello World!");
  let data = req.body;
  // console.log(data,'data')

  printLabel(data);
});

app.listen(5000, () => {
  console.log("Example app listening at http://localhost:5000");
});

// Breakdown of the EPL Command
// B: This indicates the beginning of a barcode field. The B command is used to print barcodes.

// 50: This is the X coordinate (field origin) in dots. It specifies the horizontal position of the barcode on the label, starting from the left edge. In this case, the barcode will start 50 dots from the left.

// 80: This is the Y coordinate (field origin) in dots. It indicates the vertical position of the barcode on the label, starting from the top edge. Here, the barcode will start 80 dots down from the top edge of the label.

// 0: This specifies the orientation of the barcode:

// 0: No rotation (the barcode is printed normally).
// Other values (like 1, 2, or 3) would rotate the barcode 90, 180, or 270 degrees, respectively.
// 1: This represents the barcode type:

// In this case, 1 indicates that a Code 128 barcode will be used. Different values correspond to different barcode types (e.g., Code 39, UPC, etc.).
// 2: This sets the narrow bar width multiplier. It affects the width of the narrowest bar in the barcode. A value of 2 means the narrow bars will be twice as wide as the default width.

// 5: This specifies the height of the barcode in dots. In this case, the barcode will be 5 dots tall.

// 30: This is the print ratio, which influences the overall appearance of the barcode, particularly the thickness of the bars relative to the spaces.

// N: This indicates whether to print the interpretation line (the human-readable text below the barcode):

// N: Do not print the interpretation line.
// Y: Print the interpretation line.
// "123": This is the actual data to be encoded in the barcode. In this case, the barcode will represent the string "123".

import { printDirect } from "printer";
import express from "express";
import cors from "cors";

const app = express();
app.use(express.json());
app.use(cors());

function splitText(text, maxLength) {
  const result = [];
  for (let i = 0; i < text.length; i += maxLength) {
    result.push(text.substring(i, i + maxLength));
  }
  return result;
}

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
  const printerName = "ZDesigner ZD888-203dpi ZPL";
  
  // Handle different data structures - support both nested and flat structures
  const patient = patientObj.patient || patientObj;
  const fullname = patient.name || patientObj.name;
  const visitNo = patient.visit_number || patientObj.visit_number || patientObj.visit_id;
  const pid = patientObj.id || patientObj.patient_id || patient.id;

  // Check if lab_requests exists and is an array (try different possible paths)
  const labRequests = patient.lab_requests || patientObj.lab_requests || patient.labRequests || [];
  
  if (!Array.isArray(labRequests) || labRequests.length === 0) {
    console.error("No lab requests found for patient", JSON.stringify(patientObj, null, 2));
    return;
  }

  console.log(labRequests, 'lab_requests');
  
  // Group tests by container - filter out undefined containers
  const containers = labRequests
    .map(req => {
      const mainTest = req.main_test || req.mainTest;
      return mainTest && mainTest.container ? mainTest.container : null;
    })
    .filter(container => container && container.id);

  // Remove duplicate containers by id
  const uniqueContainers = containers.filter((container, index, self) => 
    index === self.findIndex(c => c.id === container.id)
  );

  // Check if we have any valid containers
  if (uniqueContainers.length === 0) {
    console.error("No valid containers found for patient");
    return;
  }

  uniqueContainers.forEach(container => {
    // Get tests for this container
    const testsAccordingToContainer = labRequests
      .filter(req => {
        const mainTest = req.main_test || req.mainTest;
        return mainTest && mainTest.container && mainTest.container.id === container.id;
      })
      .map(req => req.name || req.test_name || 'Unknown Test');

    // Build the test string
    let tests = testsAccordingToContainer.join(" - ");

    // Split tests into multiple lines (max 20 chars each line)
    const lines = splitText(tests, 20);
    let textZpl = '';
    lines.forEach((line, i) => {
      textZpl += `A15,${100 + i * 20},0,1,1,1,N,"${line}"\n`;
    });

    // Build ZPL command (similar to PHP version)
    const zplCommand = `
Q200,312
q312
S1
D15
R
N
LO15,5,300,1
A15,10,0,3,2,2,N,"${visitNo}"
${textZpl}
${barcode(110, 30, 0, 1, 2, 3, 50, "B", pid)}
P1
`;

    // Send print job
    printDirect({
      data: zplCommand,
      printer: printerName,
      type: "RAW",
      success: function (jobID) {
        console.log(`Printed label for container ${container.id} with job ID: ${jobID}`);
      },
      error: function (err) {
        console.error(`Error printing: ${err}`);
      },
    });
  });
};

app.post("/", function (req, res) {
  try {
    let data = req.body;
    console.log('Received data:', JSON.stringify(data, null, 2));

    if (!data) {
      return res.status(400).json({ status: 'error', message: 'No data received' });
    }

    printLabel(data);
    res.json({ status: 'success', message: 'Print job sent to printer' });
  } catch (error) {
    console.error('Error processing print request:', error);
    res.status(500).json({ status: 'error', message: error.message });
  }
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

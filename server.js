const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ limit: '20mb', extended: true }));

// ========== MODELS ==========
const Applicant = mongoose.model('Applicant', new mongoose.Schema({
  firstName:String, middleName:String, surname:String,
  phone:String, pin:String, transId:String,
  wassceIndex:String, course:String, dob:String,
  address:String, disability:String,
  financerName:String, financerPhone:String, financerOccupation:String,
  wassceFile:String, birthCertFile:String, nationalIdFile:String,
  acceptanceLetterFile:String, acceptanceLetterType:String,
  status:{type:String, default:"PIN ISSUED"},
  createdAt:{type:Date, default:Date.now}
}));

const PinRequest = mongoose.model('PinRequest', new mongoose.Schema({
  phone:String, transId:String, amount:{type:Number, default:570},
  method:{type:String, default:"Orange Money"},
  schoolAccount:String,
  status:{type:String, default:"Pending"},
  generatedPin:String,
  date:{type:Date, default:Date.now}
}));

const Admin = mongoose.model('Admin', new mongoose.Schema({
  email:{type:String, unique:true}, password:String
}));

const authAdmin = (req,res,next)=>{
  try{ jwt.verify(req.headers.authorization?.split(" ")[1], process.env.JWT_SECRET||"mmtu-secret"); next(); }
  catch(e){ res.status(401).json({success:false, message:"Not authorized"}); }
};

// ========== FIXED ADMIN - ONLY YOU - NO CREATE ACCOUNT ==========
const FIXED_ADMIN_EMAIL = "Zainulsesay2@gmail.com";
const FIXED_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "03337097162018";

async function seedFixedAdmin(){
  try{
    const exists = await Admin.findOne({email: FIXED_ADMIN_EMAIL});
    if(!exists){
      const h = await bcrypt.hash(FIXED_ADMIN_PASSWORD, 10);
      await new Admin({email: FIXED_ADMIN_EMAIL, password: h}).save();
      console.log("✅ Fixed Admin Created: "+FIXED_ADMIN_EMAIL);
    } else {
      console.log("✅ Fixed Admin Already Exists");
    }
  }catch(e){ console.log("Seed Admin Error:", e.message); }
}

mongoose.connect(process.env.MONGO_URL)
  .then(async()=>{ console.log("✅ V5.0 FINAL Backend Connected"); await seedFixedAdmin(); })
  .catch(e=> console.log("Mongo Error:", e.message));

app.post('/api/admin/login', async(req,res)=>{
  const {email, password} = req.body;
  if(email !== FIXED_ADMIN_EMAIL) return res.json({success:false, message:"Access Denied - Not Admin"});
  const a = await Admin.findOne({email});
  if(!a) return res.json({success:false, message:"Admin not found"});
  const ok = await bcrypt.compare(password, a.password);
  if(!ok) return res.json({success:false, message:"Wrong password"});
  const token = jwt.sign({email:a.email}, process.env.JWT_SECRET||"mmtu-secret");
  res.json({success:true, token});
});
app.post('/api/admin/signup', async(req,res)=>{
  res.json({success:false, message:"Signup Disabled - Contact Super Admin"});
});

// ========== REQ 2: REQUEST PIN - Orange / Qcell / Afri / Bank + XII Duplicate ==========
app.post('/api/request-pin', async(req,res)=>{
  const {phone, transId, method} = req.body;
  if(!phone || !transId) return res.json({success:false, message:"Phone + Transaction ID required"});
  if(!method) return res.json({success:false, message:"Select Payment Method"});
  // XII: Phone already applied?
  const alreadyApplied = await Applicant.findOne({phone, firstName: {$ne:""}, surname: {$ne:""}});
  if(alreadyApplied) return res.json({success:false, message:"❌ This Phone Number has already been used to apply. Cannot apply twice."});
  const exists = await PinRequest.findOne({phone, transId});
  if(exists) return res.json({success:false, message:"This Transaction ID already used for this phone"});
  const dupTrans = await PinRequest.findOne({transId, phone: {$ne: phone}});
  if(dupTrans) return res.json({success:false, message:"❌ This Transaction ID has already been used by another applicant."});
  const accounts = { "Orange Money":"076 123 456", "Qcell Money":"033 123 456", "Afrimoney":"077 123 456", "Bank":"SLCB 0012345678" };
  await new PinRequest({phone, transId, method, schoolAccount: accounts[method]||""}).save();
  res.json({success:true, message:"Request sent via "+method});
});

// ========== REQ 2: ADMIN CONFIRM + AUTO PIN ==========
app.post('/api/pin-requests/:id/confirm', authAdmin, async(req,res)=>{
  const pin = "MMTU" + Math.floor(100000 + Math.random()*900000);
  const updated = await PinRequest.findByIdAndUpdate(req.params.id, {status:"Confirmed", generatedPin:pin}, {new:true});
  if(!updated) return res.json({success:false, message:"Request not found"});
  const already = await Applicant.findOne({phone:updated.phone, transId:updated.transId});
  if(!already){
    await new Applicant({phone:updated.phone, transId:updated.transId, pin, firstName:"", surname:"New Applicant", course:"Not yet applied", status:"PIN ISSUED"}).save();
  }
  res.json({success:true, pin, phone:updated.phone});
});
app.get('/api/pin-requests', authAdmin, async(req,res)=>{ res.json(await PinRequest.find().sort({date:-1})); });

// ========== REQ 3,4,5,6: TRIPLE CHECK LOGIN ==========
app.post('/api/applicant-login', async(req,res)=>{
  const {phone, transId, pin} = req.body;
  if(!phone || !transId || !pin) return res.json({success:false, message:"Phone + Transaction ID + PIN all required"});
  const pr = await PinRequest.findOne({phone, transId, generatedPin:pin, status:"Confirmed"});
  if(!pr) return res.json({success:false, message:"Check your details: Phone, Transaction ID or PIN does not match Admin record. Contact Admin."});
  let app = await Applicant.findOne({phone, transId, pin});
  if(!app) return res.json({success:false, message:"Applicant not found"});
  res.json({success:true, applicant:app});
});

// ========== REQ 7 + XII: SUBMIT FORM - VALIDATED + NO DUPLICATE ==========
app.put('/api/applicants/:id', async(req,res)=>{
  const {firstName, surname, wassceIndex, address, wassceFile, birthCertFile, dob, phone} = req.body;
  const currentId = req.params.id;
  if(!firstName?.trim() || !surname?.trim()) return res.json({success:false, message:"First Name and Surname are REQUIRED"});
  if(!wassceIndex?.trim()) return res.json({success:false, message:"WASSCE Index Number is REQUIRED"});
  if(!address?.trim()) return res.json({success:false, message:"Address is REQUIRED"});
  if(!wassceFile) return res.json({success:false, message:"WASSCE Result upload is REQUIRED (Picture/PDF)"});
  if(!birthCertFile) return res.json({success:false, message:"Birth Certificate upload is REQUIRED (Picture/PDF)"});
  const me = await Applicant.findById(currentId);
  if(!me) return res.json({success:false, message:"Applicant not found"});
  const myPhone = phone || me.phone;
  const myTransId = me.transId;
  // XII - A. Same WASSCE Index
  const dupIndex = await Applicant.findOne({ wassceIndex: wassceIndex.trim(), _id: { $ne: currentId }, firstName: { $ne: "" } });
  if(dupIndex) return res.json({success:false, message:"❌ This WASSCE Index Number has already been used. This detail has been used by another applicant."});
  // XII - B. Same Phone
  const dupPhone = await Applicant.findOne({ phone: myPhone, _id: { $ne: currentId }, firstName: { $ne: "" } });
  if(dupPhone) return res.json({success:false, message:"❌ This Phone Number has already been used. This detail has been used."});
  // XII - C. Same Transaction ID
  const dupTrans = await Applicant.findOne({ transId: myTransId, _id: { $ne: currentId }, firstName: { $ne: "" } });
  if(dupTrans) return res.json({success:false, message:"❌ This Transaction ID has already been used."});
  // XII - D. Same Name + DOB
  if(dob){
    const dupName = await Applicant.findOne({ firstName: { $regex: new RegExp("^"+firstName.trim()+"$", "i") }, surname: { $regex: new RegExp("^"+surname.trim()+"$", "i") }, dob: dob, _id: { $ne: currentId } });
    if(dupName) return res.json({success:false, message:"❌ This Name + Date of Birth has already been used. Duplicate application not allowed."});
  }
  const updated = await Applicant.findByIdAndUpdate(currentId, {...req.body, status:"PENDING"}, {new:true});
  res.json({success:true, applicant:updated});
});

// ========== ADMIN: APPLICATIONS ==========
app.get('/api/applicants', authAdmin, async(req,res)=>{ res.json(await Applicant.find().sort({createdAt:-1})); });
app.get('/api/applicants/:id', async(req,res)=>{ res.json(await Applicant.findById(req.params.id)); });
app.put('/api/applicants/:id/status', authAdmin, async(req,res)=>{
  const u=await Applicant.findByIdAndUpdate(req.params.id, {status:req.body.status}, {new:true});
  res.json({success:true, applicant:u});
});

// ========== REQ XI: ADMIN UPLOAD ACCEPTANCE LETTER ==========
app.put('/api/applicants/:id/acceptance-letter', authAdmin, async(req,res)=>{
  const {acceptanceLetterFile, acceptanceLetterType} = req.body;
  if(!acceptanceLetterFile) return res.json({success:false, message:"No file uploaded"});
  const updated = await Applicant.findByIdAndUpdate(req.params.id, {acceptanceLetterFile, acceptanceLetterType, status:"ACCEPTED"}, {new:true});
  res.json({success:true, applicant:updated});
});

// ========== REQ X: FEES SUMMARY PER METHOD ==========
app.get('/api/fees-summary', authAdmin, async(req,res)=>{
  const all = await PinRequest.find();
  const confirmed = all.filter(x=>x.status==="Confirmed");
  const byMethod = {};
  confirmed.forEach(x=>{ byMethod[x.method] = (byMethod[x.method]||0)+1; });
  res.json({ totalRequests:all.length, confirmed:confirmed.length, totalAmount: confirmed.length*570, pending: all.length-confirmed.length, byMethod, orange: byMethod["Orange Money"]||0, qcell: byMethod["Qcell Money"]||0, afri: byMethod["Afrimoney"]||0, bank: byMethod["Bank"]||0 });
});

app.get('/', (req,res)=> res.send("MMTU V5.0 Backend Running ✅"));
const PORT = process.env.PORT || 5000;
app.listen(PORT, ()=> console.log("V5.0 Running on "+PORT));

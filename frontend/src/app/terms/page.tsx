import type { Metadata } from "next";
import Link from "next/link";
import LegalPage, { LegalSection } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "শর্তাবলী",
  description:
    "Zaujain Nikah Point-এ অর্ডার, পেমেন্ট, ডেলিভারি ও কাস্টম পণ্যের শর্তাবলী।",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <LegalPage eyebrow="শর্তাবলী" title="শর্তাবলী (Terms & Conditions)" updated="১৮ জুলাই, ২০২৬">
      <p className="text-muted">
        Zaujain Nikah Point থেকে অর্ডার করার আগে অনুগ্রহ করে নিচের শর্তাবলী পড়ে নিন।
        অর্ডার করার মাধ্যমে আপনি এই শর্তগুলোতে সম্মত হচ্ছেন।
      </p>

      <LegalSection heading="১. অর্ডার ও নিশ্চিতকরণ">
        <p>
          অর্ডার দেওয়ার পর আমরা ফোনে যোগাযোগ করে অর্ডার নিশ্চিত করি। নিশ্চিত হওয়ার পরই
          পণ্য তৈরি/প্রস্তুতি শুরু হয়। ভুল বা অসম্পূর্ণ তথ্য দিলে অর্ডার বিলম্বিত বা বাতিল হতে পারে।
        </p>
      </LegalSection>

      <LegalSection heading="২. মূল্য">
        <p>
          সব দাম বাংলাদেশি টাকায় (৳)। কাস্টম অর্ডারের দাম পণ্য ও ডিজাইন অনুযায়ী আলাদাভাবে
          জানানো হয়। দাম যেকোনো সময় পরিবর্তন হতে পারে, তবে নিশ্চিত হওয়া অর্ডারের দাম অপরিবর্তিত থাকে।
        </p>
      </LegalSection>

      <LegalSection heading="৩. পেমেন্ট">
        <p>
          ডিফল্ট পেমেন্ট পদ্ধতি ক্যাশ অন ডেলিভারি — হাতে পণ্য পেয়ে টাকা দিন। কিছু ক্ষেত্রে
          (ডেলিভারি রেকর্ড অনুযায়ী) অল্প অগ্রিম বিকাশ/নগদে দিতে হতে পারে।
        </p>
      </LegalSection>

      <LegalSection heading="৪. ডেলিভারি">
        <p>
          সারা বাংলাদেশে কুরিয়ারের মাধ্যমে ডেলিভারি করা হয়, সাধারণত ৩–৭ কর্মদিবসের মধ্যে।
          ডেলিভারি চার্জ অবস্থানভেদে প্রযোজ্য এবং চেকআউটে দেখানো হয়।
        </p>
      </LegalSection>

      <LegalSection heading="৫. কাস্টমাইজড / পার্সোনালাইজড পণ্য">
        <p>
          নিকাহনামা, নাম-খোদাই বা কাস্টম ডিজাইনের পণ্য আপনার দেওয়া তথ্য অনুযায়ী বিশেষভাবে
          তৈরি হয়। <strong className="text-foreground">অর্ডার দেওয়ার আগে নাম, বানান ও তারিখ ভালো করে যাচাই করুন</strong> —
          তৈরি শুরু হয়ে গেলে এসব পরিবর্তন বা বাতিল করা যায় না।
        </p>
      </LegalSection>

      <LegalSection heading="৬. বাতিল, রিটার্ন ও রিফান্ড">
        <ul className="list-disc space-y-1 pl-5">
          <li>পার্সোনালাইজড পণ্য (নাম/তারিখ/কাস্টম ডিজাইনসহ) ফেরত বা রিফান্ডযোগ্য নয়, যদি না পণ্যে ত্রুটি থাকে বা ভুল পণ্য পাঠানো হয়।</li>
          <li>ভুল বা ত্রুটিপূর্ণ পণ্য পেলে ডেলিভারির সময়ই বা ২৪ ঘণ্টার মধ্যে ছবিসহ জানান — আমরা সংশোধন বা প্রতিস্থাপন করব।</li>
          <li>রেডিমেড (নন-কাস্টম) পণ্য অব্যবহৃত ও অক্ষত অবস্থায় ফেরতযোগ্য হতে পারে, শর্ত সাপেক্ষে।</li>
        </ul>
      </LegalSection>

      <LegalSection heading="৭. ক্ষতিগ্রস্ত বা ভুল পণ্য">
        <p>
          ডেলিভারির সময় প্যাকেট খুলে পণ্য দেখে নেওয়ার অনুরোধ রইল। কোনো ক্ষতি বা অমিল থাকলে
          সাথে সাথে আমাদের জানান, আমরা দ্রুত সমাধান করব।
        </p>
      </LegalSection>

      <LegalSection heading="৮. অর্ডার প্রত্যাখ্যান">
        <p>
          বারবার ডেলিভারি প্রত্যাখ্যান বা ভুয়া অর্ডারের ক্ষেত্রে ভবিষ্যতে অগ্রিম পেমেন্ট
          বাধ্যতামূলক হতে পারে।
        </p>
      </LegalSection>

      <LegalSection heading="৯. বৌদ্ধিক সম্পত্তি">
        <p>
          এই সাইটের সব ডিজাইন, ছবি ও কনটেন্ট Zaujain Nikah Point-এর সম্পত্তি। অনুমতি ছাড়া
          কপি বা পুনরায় ব্যবহার করা যাবে না।
        </p>
      </LegalSection>

      <LegalSection heading="১০. যোগাযোগ">
        <p>
          প্রশ্ন থাকলে: ফোন 01959976683, 01974283081 · ফেসবুক{" "}
          <a href="https://www.facebook.com/ZaujainNikahPoint" className="text-plum underline" target="_blank" rel="noreferrer">
            facebook.com/ZaujainNikahPoint
          </a>
          । আরও দেখুন:{" "}
          <Link href="/privacy" className="text-plum underline">গোপনীয়তা নীতি</Link>।
        </p>
      </LegalSection>
    </LegalPage>
  );
}

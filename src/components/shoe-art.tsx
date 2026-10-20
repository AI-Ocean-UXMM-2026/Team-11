export function ShoeArt({ color = "White" }: { color?: string }) {
  const dark = color === "Black";
  return (
    <svg
      className="shoe-art"
      viewBox="0 0 480 300"
      role="img"
      aria-label={`STT Everyday sneaker in ${color.toLowerCase()}`}
    >
      <ellipse
        cx="249"
        cy="245"
        rx="180"
        ry="16"
        fill="#193b2a"
        opacity=".11"
      />
      <path
        d="M69 203c8-20 14-49 12-72-1-12 9-17 18-8l42 31c12 5 24 1 33-7l59-67c7-9 17-7 24 1l47 60c12 14 29 23 49 29l54 14c18 5 29 19 28 35-1 8-9 12-20 12H98c-25 0-36-12-29-28Z"
        fill={dark ? "#333d37" : "#f3f1e8"}
        stroke={dark ? "#25322a" : "#c5cabe"}
        strokeWidth="2"
      />
      <path
        d="m92 130 25 62c7 15 23 20 44 20h73l-21-34-41-22c-11 9-20 13-33 9Z"
        fill={dark ? "#26322b" : "#e3e7da"}
      />
      <path
        d="m174 146 49-52c7-9 13-11 21-5l29 35-45 47Z"
        fill={dark ? "#596250" : "#d5ddc7"}
      />
      <path
        d="m184 147 45-46m-33 59 45-45m-32 57 43-44"
        stroke={dark ? "#d6dcc7" : "#fafaf2"}
        strokeWidth="8"
        strokeLinecap="round"
      />
      <path
        d="m254 139 34 28c10 8 22 15 39 20l-23 22h-58l-24-34Z"
        fill={dark ? "#212f27" : "#e0e5d5"}
      />
      <path
        d="m256 157 24 19-24 20-13-10 12-11-13-9Z"
        fill={dark ? "#b6c99b" : "#3d6445"}
      />
      <path
        d="M68 210c-4 19 11 31 34 31h307c19 0 28-8 27-23-14 7-23 9-44 9H105c-16 0-28-5-37-17Z"
        fill="#faf8eb"
        stroke="#c5cabe"
        strokeWidth="2"
      />
      <path
        d="M88 234h326"
        stroke="#cbd1bd"
        strokeWidth="2"
        strokeDasharray="3 7"
      />
      <path
        d="M321 174c7 15 10 28 10 50m-24-57c-7 16-9 33-8 57M104 146l7 34"
        fill="none"
        stroke={dark ? "#647160" : "#c3cbb9"}
        strokeWidth="2"
      />
      <path
        d="M97 193c32 20 59 21 91 19"
        fill="none"
        stroke={dark ? "#77816c" : "#c0c9b3"}
        strokeWidth="2"
        strokeDasharray="3 4"
      />
      <text
        x="355"
        y="208"
        fill={dark ? "#dce6cd" : "#54704b"}
        fontSize="13"
        fontFamily="sans-serif"
        fontWeight="700"
        letterSpacing="2"
      >
        STT
      </text>
    </svg>
  );
}

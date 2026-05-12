// Parametric garden plant marker for FlashForge Adventurer 5M Pro.
// Units are millimeters.

$fn = 36;

label = "PEPPERMINT";
tag_w = 76.2;       // 3 in
tag_h = 38.1;       // 1.5 in
spike_l = 114.3;    // 4.5 in
spike_top_w = 15;
spike_tip_w = 3;
base_z = 2.0;
text_z = 0.9;

module marker_2d() {
  union() {
    translate([-tag_w / 2, 0])
      square([tag_w, tag_h]);
    polygon([
      [-spike_top_w / 2, 0],
      [ spike_top_w / 2, 0],
      [ spike_tip_w / 2, -spike_l],
      [-spike_tip_w / 2, -spike_l]
    ]);
  }
}

module raised_text() {
  translate([0, tag_h * 0.53, base_z])
    linear_extrude(height = text_z)
      text(
        label,
        size = 11.2,
        font = "Liberation Sans:style=Bold",
        halign = "center",
        valign = "center",
        spacing = 0.82
      );
}

module top_rim() {
  translate([0, tag_h / 2, base_z])
    linear_extrude(height = 0.35)
      difference() {
        square([tag_w - 4, tag_h - 4], center = true);
        square([tag_w - 7, tag_h - 7], center = true);
      }
}

linear_extrude(height = base_z)
  marker_2d();

raised_text();
top_rim();

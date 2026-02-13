# import cv2
# import mediapipe as mp
# import numpy as np
# from scipy.spatial import distance as dist

# # ================== INIT ==================
# mp_face = mp.solutions.face_mesh
# face_mesh = mp_face.FaceMesh(refine_landmarks=True)

# cap = cv2.VideoCapture(0)

# head_counter = 0
# eye_counter = 0
# mouth_counter = 0

# STABILITY_FRAMES = 8


# # ================== MAIN LOOP ==================
# while True:
#     ret, frame = cap.read()
#     if not ret:
#         break

#     h, w, _ = frame.shape
#     rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
#     results = face_mesh.process(rgb)

#     head_shaky = 0
#     eye_moving = 0
#     mouth_abnormal = 0

#     if results.multi_face_landmarks:
#         for face in results.multi_face_landmarks:
#             landmarks = [(int(l.x * w), int(l.y * h)) for l in face.landmark]

#             # =====================================================
#             # 1️⃣ HEAD STABILITY CHECK
#             # =====================================================
#             left_face = landmarks[234]
#             right_face = landmarks[454]
#             nose = landmarks[1]

#             left_dist = abs(nose[0] - left_face[0])
#             right_dist = abs(right_face[0] - nose[0])
#             head_diff = abs(left_dist - right_dist)

#             if head_diff > 25:
#                 head_counter += 1
#             else:
#                 head_counter = 0

#             head_shaky = 1 if head_counter > STABILITY_FRAMES else 0


#             # =====================================================
#             # 2️⃣ EYE CENTER CHECK + DRAW DOTS
#             # =====================================================
#             left_eye_left = landmarks[33]
#             left_eye_right = landmarks[133]
#             left_iris = landmarks[468]

#             # Eye center reference
#             left_eye_center = (
#                 int((left_eye_left[0] + left_eye_right[0]) / 2),
#                 int((left_eye_left[1] + left_eye_right[1]) / 2)
#             )

#             iris_offset = abs(left_iris[0] - left_eye_center[0])

#             if iris_offset > 10:
#                 eye_counter += 1
#             else:
#                 eye_counter = 0

#             eye_moving = 1 if eye_counter > STABILITY_FRAMES else 0

#             # Draw iris center (Green)
#             cv2.circle(frame, left_iris, 5, (0, 255, 0), -1)

#             # Draw ideal eye center (Blue)
#             cv2.circle(frame, left_eye_center, 5, (255, 0, 0), -1)

#             # Draw deviation line (Yellow)
#             cv2.line(frame, left_iris, left_eye_center, (0, 255, 255), 2)


#             # =====================================================
#             # 3️⃣ MOUTH CHECK
#             # =====================================================
#             top_lip = landmarks[13]
#             bottom_lip = landmarks[14]
#             chin = landmarks[152]
#             forehead = landmarks[10]

#             mouth_open_dist = dist.euclidean(top_lip, bottom_lip)
#             face_height = dist.euclidean(chin, forehead)

#             mouth_ratio = mouth_open_dist / face_height

#             if mouth_ratio > 0.05:
#                 mouth_counter += 1
#             else:
#                 mouth_counter = 0

#             mouth_abnormal = 1 if mouth_counter > STABILITY_FRAMES else 0


#             # =====================================================
#             # DISPLAY RESULTS
#             # =====================================================
#             cv2.putText(frame, f"Head Shaky: {head_shaky}", (30, 40),
#                         cv2.FONT_HERSHEY_SIMPLEX, 0.8,
#                         (0, 0, 255) if head_shaky else (0, 255, 0), 2)

#             cv2.putText(frame, f"Eye Moving: {eye_moving}", (30, 80),
#                         cv2.FONT_HERSHEY_SIMPLEX, 0.8,
#                         (0, 0, 255) if eye_moving else (0, 255, 0), 2)

#             cv2.putText(frame, f"Mouth Abnormal: {mouth_abnormal}", (30, 120),
#                         cv2.FONT_HERSHEY_SIMPLEX, 0.8,
#                         (0, 0, 255) if mouth_abnormal else (0, 255, 0), 2)

#             print("Head:", head_shaky,
#                   "Eye:", eye_moving,
#                   "Mouth:", mouth_abnormal)

#     cv2.imshow("Holocare Stability Detection", frame)

#     if cv2.waitKey(1) & 0xFF == 27:
#         break

# cap.release()
# cv2.destroyAllWindows()
# 
import cv2
import mediapipe as mp
import numpy as np
from scipy.spatial import distance as dist
import math

mp_face = mp.solutions.face_mesh
face_mesh = mp_face.FaceMesh(refine_landmarks=True)

cap = cv2.VideoCapture(0)

# ================= PARAMETERS =================
HEAD_MIN = 85
HEAD_MAX = 95
GAZE_THRESHOLD = 6
SEQUENCE_LENGTH = 6

gaze_sequence = []

# ================= MAIN LOOP =================
while True:
    ret, frame = cap.read()
    if not ret:
        break

    h, w, _ = frame.shape
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    results = face_mesh.process(rgb)

    head_abnormal = 0
    gaze_abnormal = 0

    if results.multi_face_landmarks:
        for face in results.multi_face_landmarks:
            landmarks = [(int(l.x * w), int(l.y * h)) for l in face.landmark]

            # =====================================================
            # 1️⃣ HEAD POSE ESTIMATION (REAL ANGLE)
            # =====================================================
            image_points = np.array([
                landmarks[1],    # Nose tip
                landmarks[152],  # Chin
                landmarks[33],   # Left eye corner
                landmarks[263],  # Right eye corner
                landmarks[61],   # Left mouth
                landmarks[291]   # Right mouth
            ], dtype="double")

            model_points = np.array([
                (0.0, 0.0, 0.0),
                (0.0, -330.0, -65.0),
                (-225.0, 170.0, -135.0),
                (225.0, 170.0, -135.0),
                (-150.0, -150.0, -125.0),
                (150.0, -150.0, -125.0)
            ])

            focal_length = w
            center = (w / 2, h / 2)

            camera_matrix = np.array(
                [[focal_length, 0, center[0]],
                 [0, focal_length, center[1]],
                 [0, 0, 1]], dtype="double"
            )

            dist_coeffs = np.zeros((4, 1))

            success, rotation_vector, translation_vector = cv2.solvePnP(
                model_points, image_points, camera_matrix, dist_coeffs)

            rmat, _ = cv2.Rodrigues(rotation_vector)
            angles, _, _, _, _, _ = cv2.RQDecomp3x3(rmat)

            pitch = angles[0]
            yaw = angles[1] 
            roll = angles[2] 

        head_angle = yaw
        if abs(head_angle) > 10:
            head_abnormal = 1

            # =====================================================
            # 2️⃣ BOTH EYE IRIS TRACKING
            # =====================================================
            left_iris = landmarks[468]
            right_iris = landmarks[473]

            left_eye_left = landmarks[33]
            left_eye_right = landmarks[133]

            right_eye_left = landmarks[362]
            right_eye_right = landmarks[263]

            left_eye_center = (
                int((left_eye_left[0] + left_eye_right[0]) / 2),
                int((left_eye_left[1] + left_eye_right[1]) / 2)
            )

            right_eye_center = (
                int((right_eye_left[0] + right_eye_right[0]) / 2),
                int((right_eye_left[1] + right_eye_right[1]) / 2)
            )

            # Draw iris dots
            cv2.circle(frame, left_iris, 4, (0,255,0), -1)
            cv2.circle(frame, right_iris, 4, (0,255,0), -1)

            # Compute horizontal deviation
            left_offset = left_iris[0] - left_eye_center[0]
            right_offset = right_iris[0] - right_eye_center[0]

            avg_offset = (left_offset + right_offset) / 2

            # Store sequence
            gaze_sequence.append(avg_offset)

            if len(gaze_sequence) > SEQUENCE_LENGTH:
                gaze_sequence.pop(0)

            # Detect oscillation left-right
            if len(gaze_sequence) == SEQUENCE_LENGTH:
                if max(gaze_sequence) > GAZE_THRESHOLD and min(gaze_sequence) < -GAZE_THRESHOLD:
                    gaze_abnormal = 1

            # =====================================================
            # DISPLAY
            # =====================================================
            cv2.putText(frame, f"Head Angle: {int(head_angle)}",
                        (30, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.7,
                        (255,255,0), 2)

            cv2.putText(frame, f"Head Abnormal: {head_abnormal}",
                        (30, 80), cv2.FONT_HERSHEY_SIMPLEX, 0.7,
                        (0,0,255) if head_abnormal else (0,255,0), 2)

            cv2.putText(frame, f"Gaze Abnormal: {gaze_abnormal}",
                        (30, 120), cv2.FONT_HERSHEY_SIMPLEX, 0.7,
                        (0,0,255) if gaze_abnormal else (0,255,0), 2)

            print("Head:", head_abnormal,
                  "Gaze:", gaze_abnormal)

    cv2.imshow("Holocare Advanced Tracking", frame)

    if cv2.waitKey(1) & 0xFF == 27:
        break

cap.release()
cv2.destroyAllWindows()

